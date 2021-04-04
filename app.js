require('dotenv').config();
const axios = require('axios').default;
const schedule = require('node-schedule');
const Gpio = require('onoff').Gpio;

// Assign the heater to a GPIO pin
const heater = new Gpio(18, 'out');

// min/max duty cycle
const duty = [0.1, 0.8];
// PWM interval (ms)
const interval = 2000;

// Use this to calculate our running average.
let history = [0, 0, 0, 0, 0];
// min/max measurement range (will be updated over time)
let range = [0, 15];

let sources = {
  wind: {
    url: `https://swd.weatherflow.com/swd/rest/observations/station/40983?token=${process.env.TOKEN}`,
  },
  aircraft: {
    url: 'http://192.168.1.5/dump1090-fa/data/aircraft.json',
  },
};

// Calculate the average of the values in an array
function avg(arr) {
  const total = arr.reduce((acc, c) => acc + c, 0);
  const avg = total / arr.length;
  return Math.round((avg + Number.EPSILON) * 10) / 10; // 1 decimal place
}

// Affine transformation (y = mx + b)
// with stops at duty[0,1]
function transform(x) {
  let y =
    ((duty[1] - duty[0]) / (range[1] - range[0])) * (x - range[0]) + duty[0];
  y = y <= duty[1] ? y : duty[1];
  y = y >= duty[0] ? y : duty[0];
  return y;
}

function doPwm(y) {
  heater.writeSync(1);
  setTimeout(() => {
    heater.writeSync(0);
  }, y * interval);
}

function startHeater() {
  setInterval(() => {
    doPwm(transform(avg(history)));
  }, interval);
}

function getData(type) {
  let val;
  axios.get(sources[type].url).then((response) => {
    switch (type) {
      case 'wind':
        val = response.data.obs[0]['wind_gust'];
        break;
      case 'aircraft':
        val = response.data.aircraft.length;
        break;
    }
    if (val < range[0]) range[0] = val;
    if (val > range[1]) range[1] = val;
    history.shift();
    history.push(val);
    console.log(type, 'history', history, 'avg', avg(history));
    console.log(type, 'range', range[0], range[1]);
  });
}

startHeater();
getData('aircraft');
// Grab the latest weather every minute
schedule.scheduleJob('*/1 * * * *', () => {
  getData('aircraft');
});
