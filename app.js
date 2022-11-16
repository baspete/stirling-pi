const axios = require('axios');
const Gpio = require('onoff').Gpio;
const ssd1306 = require('ssd1306-i2c-js');

// Grab our configuration
const config = require('./config.js');

// Default is no display
let display,
  Font,
  Color,
  Layer = null;

if (config.displayAddress) {
  display = ssd1306.display;
  Font = ssd1306.Font;
  Color = ssd1306.Color;
  Layer = ssd1306.Layer;

  display.init(1, config.displayAddress); // Open bus and initialize driver
  display.setFont(Font.UbuntuMono_8ptFontInfo);
  display.turnOn(); // Turn on display module
  display.clearScreen(); // Clear display buffer
}

// ***********************************************
// FUNCTIONS

/**
 * Given an array of numbers, calculate the average.
 * Rounds to 1 decimal place. Returns zero if arr is empty.
 * @param {array} arr
 * @returns {number}
 */
function avg(arr) {
  // If the array is empty, just return zero;
  if (arr.length === 0) return 0;
  // If the array has one value, just return that value;
  if (arr.length === 1) return arr[0].toFixed(1);
  // Otherwise average the values
  const total = arr.reduce((b, c) => b + c, 0);
  const avg = total / arr.length;
  return avg.toFixed(1);
}

/**
 * Affine transformation (y = mx + b)
 * Given a number, a domain and a range
 * this will do an affine transformation with stops
 * at range[0] and range[1]. Use this to figure out
 * how long the duty cycle should be.
 * @param {number} x
 * @param {array} domain - possible input value endpoints
 * @param {array} range - possible output value endpoints
 * @returns {number} y (rounded to 2 decimal places)
 */
function calculateDutyCycle(x, domain, range) {
  let y =
    ((range[1] - range[0]) / (domain[1] - domain[0])) * (x - domain[0]) +
    range[0];
  // Round to 2 decimal places
  y = y.toFixed(2);
  // Stops at range[0] and range[1]
  y = y <= range[1] ? y : range[1];
  y = y >= range[0] ? y : range[0];
  return y;
}

/**
 *
 * @param {string} url
 * @param {object} auth 'auth' option to pass to axios
 * @param {function} filter optional function to filter response
 * @returns
 */
function getData(url, auth, filter) {
  return new Promise((resolve, reject) => {
    let val;
    const options = { auth: auth || null };
    axios
      .get(url, options)
      .then((response) => {
        // Call the filter function
        val = filter(response);
        // Return the value value
        resolve(val);
      })
      .catch((error) => {
        console.error(error);
      });
  });
}

/**
 * @param {object} display An initialized display object
 * @param {number} val The value to display
 * @param {array} range The min/max values
 */
function updateDisplay(display, val, range) {
  // Don't bother if we don't have a display
  if (!display) return;
  // Make sure val is within range
  if (val === null) {
    val = range[0];
  } else if (val < range[0]) {
    val = range[0];
  } else if (val > range[1]) {
    val = range[1];
  }
  const fontSize = 5;
  valStr = val.toString() || '--';
  const stringStart = 64 - valStr.length * 15;
  const width = Math.max(
    parseInt((128 * (val || range[0])) / range[1] - range[0]),
    1
  ); // at least on px
  console.log('width', width);
  display.clearScreen(); // Clear display buffer
  // Render the meter
  display.drawRect(0, 0, width, 12, Color.White, Layer.Layer0);
  // Render the text
  display.drawString(
    stringStart,
    17,
    valStr,
    fontSize,
    Color.White,
    Layer.Layer0
  );
  display.refresh();
}

// ***********************************************
// STARTUP

// Do we have what we need to run?
if (
  config.dataType &&
  config.sources[config.dataType] &&
  config.sources[config.dataType].url
) {
  const dataType = config.dataType;
  const source = config.sources[dataType];

  // Set some defaults if not provided
  const duty = config.duty || [0.2, 0.7];
  const pwmInterval = config.pwmInterval || 2000; // ms
  const heaterPin = config.heaterPin || 18; // physical pin 12
  const dataInterval = source.dataInterval || 60; // seconds
  const samplesToAverage = source.samplesToAverage || 1;
  let minMax = source.minMax || [0, 10]; // NOTE: mutable

  // This will hold the last few measurements, so
  // we can calculate a running average for noisy data.
  let history = [];

  // Assign the heater to a GPIO pin
  const heater = new Gpio(heaterPin, 'out');

  // Initialize the OLED display
  updateDisplay(display, null, minMax);

  // This is the main PWM loop, running continuously at 'interval' milliseconds
  setInterval(() => {
    heater.writeSync(1); // heater on
    setTimeout(() => {
      heater.writeSync(0); // heater off
    }, calculateDutyCycle(avg(history), minMax, duty) * pwmInterval);
  }, pwmInterval);

  // This is the main data loop, running continuously at 'dataInterval' seconds
  setInterval(async () => {
    let val = await getData(source.url, source.auth, source.filter);

    // Do we need to move the min/max range wider?
    if (val < minMax[0]) minMax[0] = val;
    if (val > minMax[1]) minMax[1] = val;

    // Update the history array
    history.push(val);

    // Keep only the last `samplesToAverage` values
    if (history.length > samplesToAverage) {
      history.shift();
    }

    // Log something useful
    console.info(
      dataType,
      history,
      'avg:',
      avg(history),
      `(${minMax[0]}-${minMax[1]})`,
      'duty cycle:',
      calculateDutyCycle(avg(history), minMax, duty)
    );

    // Send something to the OLED display
    updateDisplay(display, val, minMax);

    // If there's a callback, pass it the value
    if (source.callback) {
      source
        .callback(val)
        .then((response) => {
          // console.log('Callback Finished');
        })
        .catch((error) => {
          console.log(
            'Callback error:',
            error.response.status,
            error.response.statusText
          );
        });
    }
  }, dataInterval * 1000);
} else {
  console.log('Error: missing config. Stopping.');
}
