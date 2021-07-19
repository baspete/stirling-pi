require('dotenv').config();
const axios = require('axios').default;
const schedule = require('node-schedule');
const Gpio = require('onoff').Gpio;
const { http, https } = require('follow-redirects');

// ***********************************************
// AUTHENTICATION

const authHost = 'https://app.vssps.visualstudio.com/oauth2/authorize?client_id=166896BA-1284-4D74-ACBE-02C07DC0B002&response_type=Assertion&state=foo&scope=vso.agentpools&redirect_uri=https://localhost';
const tokenHost = 'https://app.vssps.visualstudio.com/oauth2/token?client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer&grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer'

axios.get(authHost).then(response => {
  console.log('response', response);
})

// const request = https.request({
//   host: authHost
// }, response => {
//   console.log(response.responseUrl);
// });
// request.end();


// ***********************************************
// CONFIGURATION

// Min/Max duty cycle. duty[0] is the min required to keep
// the stirling engine idling. duty[1] is the max to keep
// it from spinning like a monkey on cocaine and throwing a rod.
const duty = [0.1, 0.7];

// Length (ms) of each PWM interval.
const pwmInterval = 2000;

// Heater control pin.
const heaterPin = 18; // physical pin 12

// Data sources, parameter to measure, initial min/max guesses etc
const sources = {
  wind: {
    url: `https://swd.weatherflow.com/swd/rest/observations/station/40983?token=${process.env.TOKEN}`,
    param: 'wind_gust',
    minMax: [0, 10],
    historyLength: 3, // super noisy
    dataInterval: 1,
  },
  aircraft: {
    url: 'http://192.168.1.5/dump1090-fa/data/aircraft.json',
    param: 'flight',
    minMax: [10, 100],
    historyLength: 1, // not noisy
    dataInterval: 1,
  },
  builds: {
    url: 'https://dev.azure.com/geaviationdigital-dss/_apis/distributedtask/pools/27/agents',
    param: 'value',
    minMax: [0, 10],
    historyLength: 1, // not noisy
    dataInterval: 1,
    auth: {
      authUrl: 'https://app.vssps.visualstudio.com/oauth2/authorize&response_type=Assertion',
      tokenUrl: 'https://app.vssps.visualstudio.com/oauth2/token?client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer&grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer',
    }
  }
};

// ***********************************************
// FUNCTIONS

/**
 * Given an array of numbers, calculate the average.
 * Rounds to 1 decimal place.
 * @param {array} arr
 * @returns {number}
 */
function avg(arr) {
  const total = arr.reduce((b, c) => b + c, 0);
  const avg = total / arr.length;
  return Math.round((avg + Number.EPSILON) * 10) / 10;
}

/**
 * Affine transformation (y = mx + b)
 * Given a number, a domain and a range
 * this will do an affine transformation with stops
 * at range[0] and range[1].
 * @param {number} x
 * @param {array} domain - possible input value endpoints
 * @param {array} range - possible output value endpoints
 * @returns {number} y (rounded to 2 decimal places)
 */
function transform(x, domain, range) {
  let y =
    ((range[1] - range[0]) / (domain[1] - domain[0])) * (x - domain[0]) +
    range[0];
  // Round to 2 decimal places
  y = Math.round((y + Number.EPSILON) * 100) / 100;
  // Stops at range[0] and range[1]
  y = y <= range[1] ? y : range[1];
  y = y >= range[0] ? y : range[0];
  return y;
}

/**
 * Given an array of dump1090 ADS-B data, return a
 * filtered array based on the presence of a property.
 * The goal here is to remove non-aircraft items.
 * @param {array} aircraft - array of aircraft
 * @param {string} property - the property to filter on
 * @returns {array}
 */
function filterAircraft(aircraft, property) {
  let results = aircraft.filter((a) => {
    return a[property] ? true : false;
  });
  return results;
}

/**
 * Retrieve data and update the history. Updates the appropriate
 * minMax if data is outside current values.
 * @param {string} type Data type ('aircraft', 'wind', etc)
 */
function getData(type) {
  return new Promise((resolve, reject) => {
    let val;
    axios
      .get(sources[type].url)
      .then((response) => {
        switch (type) {
          case 'wind':
            val = response.data.obs[0][sources[type].param];
            break;
          case 'aircraft':
            val = filterAircraft(response.data.aircraft, sources[type].param)
              .length;
            break;
        }
        // Do we need to move the min/max stops wider?
        if (val < sources[type].minMax[0]) sources[type].minMax[0] = val;
        if (val > sources[type].minMax[1]) sources[type].minMax[1] = val;
        // Update the history array
        history.push(val);
        // Keep only the last `historyLength` values
        if (history.length > sources[type].historyLength) {
          history.shift();
        }
        // Log something useful
        console.info(
          type,
          'history:',
          history,
          'avg:',
          avg(history),
          `(${sources[type].minMax[0]}-${sources[type].minMax[1]})`,
          'duty cycle:',
          transform(avg(history), sources[dataType].minMax, duty)
        );
        resolve(val);
      })
      .catch((error) => {
        console.error(error);
      });
  });
}

// ***********************************************
// STARTUP

// Which data source to use
const dataType = process.env.TYPE;

// This will hold the last few measurements, so
// we can calculate a running average for noisy data.
let history = [];

// Get initial data and populate the history array.
getData(dataType).then((val) => history.push(val));

// Assign the heater to a GPIO pin
const heater = new Gpio(heaterPin, 'out');

// This is the main PWM loop, running continuously at 'interval'
setInterval(() => {
  heater.writeSync(1); // heater on
  setTimeout(() => {
    heater.writeSync(0); // heater off
  }, transform(avg(history), sources[dataType].minMax, duty) * pwmInterval);
}, pwmInterval);

// Set a schedule to grab data at the right interval
schedule.scheduleJob(`*/${sources[dataType].dataInterval} * * * *`, () => {
  getData(dataType);
});
