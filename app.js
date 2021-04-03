require('dotenv').config();
const axios = require('axios').default;
const schedule = require('node-schedule');
const Gpio = require('onoff').Gpio;

// Assign the heater to a GPIO pin
const heater = new Gpio(18, 'out');

// min/max duty cycle
const duty = [0.1, 0.8];
// what measurement are we looking for
const mKey = 'wind_gust';
// min/max measurement range
const range = [0, 15];

// PWM interval (ms)
const interval = 2000;

const url = `https://swd.weatherflow.com/swd/rest/observations/station/40983?token=${process.env.TOKEN}`;

// this object will hold our latest observation
let obs = {};

// Use this to calculate our running average.
let mHistory = [0, 0, 0, 0, 0];

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
    doPwm(transform(avg(mHistory)));
  }, interval);
}

function getLatestObs() {
  axios.get(url).then((response) => {
    obs = response.data.obs[0];
    console.log('latest obs', obs);
    mHistory.shift();
    mHistory.push(obs[mKey]);
    console.log('history', mHistory, 'avg', avg(mHistory));
  });
}

function avg(arr) {
  const total = arr.reduce((acc, c) => acc + c, 0);
  const avg = total / arr.length;
  return Math.round((avg + Number.EPSILON) * 10) / 10; // 1 decimal place
}

// Startup
getLatestObs();
startHeater();
// Grab the latest weather every minute
schedule.scheduleJob('*/1 * * * *', () => {
  getLatestObs();
});
