require('dotenv').config();
const axios = require('axios');
const dayjs = require('dayjs');

const config = {
  // (optional) Min/Max duty cycle. duty[0] is the min required to keep
  // the stirling engine idling. duty[1] is the max to keep
  // it from spinning like a monkey on cocaine and throwing a rod.
  duty: [0.2, 0.7],

  // (optional) Length (ms) of each PWM interval.
  pwmInterval: 2000,

  // (optional) Heater control pin.
  heaterPin: 18, // physical pin 12

  // Data sources, number of samples to average, interval, initial min/max guesses etc
  sources: {
    wind: {
      // this is required
      url: `https://swd.weatherflow.com/swd/rest/observations/station/${process.env.WEATHERFLOW_STATION_ID}?token=${process.env.WEATHERFLOW_TOKEN}`,
      // these are optional
      minMax: [0, 10],
      samplesToAverage: 3, // super noisy, so let's use a longer history
      dataInterval: 30,
      filter: function (response) {
        let val = response.data.obs[0]['wind_gust'];
        return val;
      },
    },
    aircraft: {
      // this is required
      url: `http://${process.env.PIAWARE_HOST}/dump1090-fa/data/aircraft.json`,
      // these are optional
      minMax: [0, 100],
      samplesToAverage: 1,
      dataInterval: 60,
      filter: function (response) {
        let aircraft = response.data.aircraft.filter((a) => {
          return a.flight ? true : false;
        });
        return aircraft.length;
      },
    },
    agents: {
      // this is required
      url: `https://dev.azure.com/geaviationdigital-dss/_apis/distributedtask/pools/${process.env.AGENT_POOL_ID}/agents`,
      // these are optional
      minMax: [0, 20],
      samplesToAverage: 1,
      dataInterval: 60,
      auth: {
        username: '',
        password: process.env.DEVOPS_PAT,
      },
      filter: function (response) {
        let agents = response.data.value.filter((a) => {
          return a.provisioningState === 'RunningRequest';
        });
        return agents.length;
      },
      callback: function (val) {
        return new Promise((resolve, reject) => {
          const url = `${process.env.BLOB_URL}&comp=appendblock`;
          const body = `\n${dayjs().toISOString()},${val}`;
          axios
            .put(url, body, {
              headers: { 'Content-Type': 'text/plain' },
            })
            .then((response) => {
              resolve(response.data);
            })
            .catch((error) => {
              console.error(error);
              reject(error);
            });
        });
      },
    },
  },

  // (required) Which data source from the 'sources' map to use,
  dataType: 'agents',
};

module.exports = config;
