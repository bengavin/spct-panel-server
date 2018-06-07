var express = require('express');
var bodyParser = require('body-parser');
var SerialPort = require('serialport');
var PanelStateMachine = require('./state-machine').PanelStateMachine;
var PanelState = require('./state-machine').PanelState;

// Initialize the Raspberry Pi infrastructure
var rpio = require('rpio');
var pwrLedOpen = false;
const pwrLedPin = 11;
var serialOpen = false;
var arduino = new SerialPort('/dev/serial0', { baudRate: 9600, autoOpen: false });;
var stateMachine = new PanelStateMachine();

// Wire up Arduino (Serial Port) events
arduino.on('error', function (err) {
  console.log('Error speaking at the serial port: ', err);
});

arduino.on('open', function () {
  console.log('Serial Port Opened');
  arduino.flush(); // Flush any existing buffers
  serialOpen = true;
  //arduino.write('HELLO\n');
});

arduino.on('close', function () {
  console.log('Serial Port Closed');
  serialOpen = false;
});

// Setup data flow/parsing to emit UTF-8 line-at-a-time from the input
const Readline = require("@serialport/parser-readline");
const parser = arduino.pipe(new Readline()); // defaults to '\n', utf-8
parser.on('data', function(data) {
    console.log('Received Data on Serial Line: ', data);
    stateMachine.process(data);
});

// Get our state machine wired up
stateMachine.on('send', function (command) {
    if (!serialOpen) {
        console.log('WARNING: State Machine attempted to operate on a closed serial port, will open on demand');
    }
    // else {
         arduino.write(command + "\n");
    // }
});

stateMachine.on('response', function (response, previousState, currentState) {
    console.log('SUCCESS: State Machine transitioned from ', previousState, ' to ', currentState);
    if (currentState === PanelState.CONNECTED) {
        if (!pwrLedOpen) {
            // Indicate we are connected
            rpio.open(pwrLedPin, rpio.OUTPUT, rpio.LOW);
            rpio.write(pwrLedPin, rpio.HIGH);
            pwrLedOpen = true;
        }
    }
    else if (currentState === PanelState.DISCONNECTED) {
        if (serialOpen) {
           arduino.close();
        }

        if (pwrLedOpen) {
            rpio.write(pwrLedPin, rpio.LOW);
            rpio.close(pwrLedPin);
            pwrLedOpen = false;
        }
    }
});

stateMachine.on('command', function (command, currentState) {
    console.log('COMMAND: State Machine received the ', command, ' command in state ', currentState);
});

stateMachine.on('error', function (error, currentState) {
    console.log('ERROR: Received error from state machine ', error, ' in current state ', currentState);
})

var app = express();
app.use(bodyParser.json());
app.set('port', process.env.LIGHTPANEL_PORT || 8800);

app.put('/connect', function(req, res) {
    if (!serialOpen) {
      arduino.open(function(err) {
        if (err) {
          return console.log('Error opening serial port: ', err);
        }
      });
    }

    if (!stateMachine.connectToPanel()){
        console.log('Unable to connect to panel');
        res.status(304).send('Already connected');
    }
    else {
      res.status(204).send('Successfully connected');
    }
});

app.delete('/connect', function(req, res) {
    if (!stateMachine.disconnectFromPanel()) {
        console.log('Error disconnecting from panel');
        res.status(304).send('Disconnect Failed');
    }
    else {
        res.status(204).send('Disconnecting');
    }
});

app.get('/state', function (req, res) {
    res.status(200).send({ state: stateMachine.getCurrentState() });
});

app.put('/tempo/:line?', function (req, res) {
    var line = parseInt(req.params.line) || 2;
    var bpm = parseInt(req.body.bpm);

    if (!stateMachine.setLineTempo(line, bpm)) {
        console.log('Unable to set line tempo: line ', line, ', bpm: ', bpm);
        res.status(304).send('Failed');
    }
    else{
        res.status(204).send('Set new tempo for line ' + line + ' to ' + bpm + ' beats per minute');
    }
});

app.put('/led', function (req, res) {
    var row = parseInt(req.body.row) || 0;
    var col = parseInt(req.body.column) || 0;
    var color = req.body.color;
    var state = req.body.state;

    if (typeof state === undefined || state == null || state == "") {
        // User is just setting color
        if (!stateMachine.setLedColor(row, col, color)) {
            console.log('Failed to set LED (',row,',',col,') to color ',color);
            res.status(304).send('Failed');
        }
        else {
            res.status(204).send('Success');
        }
    }
    else if (typeof color === undefined || color == null || color == "") {
        // User is just turning the light on/off
        if (!stateMachine.setLedOnOff(row, col, state)) {
            console.log('Failed to set LED (',row,',',col,') to state ',state);
            res.status(304).send('Failed');
        }
        else {
            res.status(204).send('Success');
        }
    }
    else {
        // User is setting both color and state
        if (!stateMachine.setLed(row, col, color, state)) {
            console.log('Failed to set LED (',row,',',col,') to color ',color,' and state ',state);
            res.status(304).send('Failed');
        }
        else {
            res.status(204).send('Success');
        }
    }
});

app.put('/line/:line', function (req, res) {
    var line = parseInt(req.params.line);

    console.log('Resetting line ' + line);
    if (!stateMachine.resetLine(line)) {
        console.log('Error resetting LED line ',line);
        res.status(304).send('Failed');
    }
    else{
        res.status(204).send('Success');
    }
});

app.delete('/line/:line', function (req, res) {
    var line = parseInt(req.params.line);
    var reset = req.query.reset;

    if (!stateMachine.stopLine(line, reset)) {
        console.log('Error stopping LED line ',line,' with reset ',reset);
        res.status(304).send('Failed');
    }
    else {
        res.status(204).send('Success');
    }
});

app.delete('/leds', function (req, res) {
    if (!stateMachine.turnPanelOff()) {
        console.log('Error turning off panel');
        res.status(304).send('Failed');
    }
    else {
        res.status(204).send('Success');
    }
});

// Express route for any other unrecognised incoming requests
app.all('*', function(req, res) {
    res.status(404).send('Unrecognised API call');
});

// Express route to handle errors
app.use(function(err, req, res, next) {
    if (req.xhr) {
        res.status(500).send('Oops, Something went wrong!');
    } else {
        next(err);
    }
});

// Setup our graceful teardown messages
process.on('SIGTERM', () => {
    console.info('Got SIGTERM. Graceful shutdown start', new Date().toISOString());
    // start graceful shutdown here
    stateMachine.disconnectFromPanel();
    if (serialOpen) {
        arduino.close();
        serialOpen = false;
    }
    server.close();
    //if (pwrLedOpen) { rpio.write(pwrLedPin, rpio.LOW); rpio.close(pwrLedPin); }
    //if (serialOpen) { arduino.drain(function () { server.close(); }); }
    //else { server.close(); }
});

process.on('SIGINT', () => {
    console.info('Got SIGINT. Graceful shutdown start', new Date().toISOString());
    // start graceful shutdown here
    stateMachine.disconnectFromPanel();
    if (serialOpen) {
        arduino.close();
        serialOpen = false;
    }
    server.close();
});


var server = app.listen(app.get('port'), () => {
    console.log('Listening on port %d', server.address().port);
});
