const EventEmitter = require('events').EventEmitter;
const util = require('util');
const colorParser = require('parse-color');

function PanelState() {}
PanelState.prototype.UNKNOWN = 0;
PanelState.prototype.DISCONNECTED = 1;
PanelState.prototype.CONNECTING = 2;
PanelState.prototype.CONNECTED = 3;
PanelState.prototype.INITIALIZED = 4;
// Other possible panel states here...
PanelState.prototype.DISCONNECTING = 99;

exports.PanelState = new PanelState();

var PanelStateMachine = function () {
    // Instance properties
    this._currentState = exports.PanelState.DISCONNECTED;
    this._successResponse = "";
    this._successState = exports.PanelState.UNKNOWN;
    this._waitingForResponse = false;
}
util.inherits(PanelStateMachine, EventEmitter);

PanelStateMachine.prototype.connectToPanel = function() {
    if (this._currentState !== exports.PanelState.DISCONNECTED) {
        this.emit('error', "Panel is not current disconnected");
        return false;
    }

    this._currentState = exports.PanelState.CONNECTING;
    this._successResponse = "READY";
    this._successState = exports.PanelState.CONNECTED;
    this._waitingForResponse = true;

    this.emit('send', 'HELLO');
    return true;
}

PanelStateMachine.prototype.disconnectFromPanel = function() {
    if (this._currentState < exports.PanelState.CONNECTING) {
        this.emit('error', 'Panel is not connected');
        return false;
    }
    else if (this._currentState === exports.PanelState.CONNECTING) {
        this._waitingForResponse = false;
        this._successResponse = "";
        this._successState = exports.PanelState.UNKNOWN;
    }
    else if (this._currentState !== exports.PanelState.DISCONNECTING) {
        // We are connected, we should do something about this
        this._successResponse = "SHUTDOWN";
        this._currentState = exports.PanelState.DISCONNECTING;
        this._successState = exports.PanelState.DISCONNECTED;
        this._waitingForResponse = true;
        this.emit('send', 'GOODBYE');
    }

    return true;
}

PanelStateMachine.prototype.getCurrentState = function () {
    return this._currentState;
}

PanelStateMachine.prototype.processCommand = function (command) {
    this.emit('command', command, this._currentState);
}

PanelStateMachine.prototype.processResponse = function(response) {
    if (this._successResponse == response.trim()) {
        this.emit('response', response, this._currentState, this._successState);

        this._currentState = this._successState;
        this._successResponse = "";
        this._successState = exports.PanelState.UNKNOWN;
        this._waitingForResponse = false;

        return true;
    }

    // That wasn't what I was looking for
    // TODO: Handle timeouts
    return false;
}

PanelStateMachine.prototype.process = function (commandOrResponse) {
    if (this._waitingForResponse) {
        // Try to treat it as a response
        if (this.processResponse(commandOrResponse)) {
            return true;
        }
    }

    return this.processCommand(commandOrResponse);
}

PanelStateMachine.prototype.setLineTempo = function (line, tempoBpm) {
    if (!this.__validateRow(line)) {
        return false;
    }

    if (tempoBpm <= 0 || tempoBpm > 360) {
        this.emit('error', 'Tempo beats per minute must be greater than 0 and less than 360');
        return false;
    }

    this._successResponse = "TEMPO " + tempoBpm;
    this._successState = this._currentState;
    this._waitingForResponse = true;

    this.emit('send', ['SETTEMPO', tempoBpm].join(' '));
    return true;
}

PanelStateMachine.prototype.setLedColor = function (row, column, colorString) {
    if (!this.__validateRow(row) || !this.__validateColumn(column)) { return false; }

    var color = colorParser(colorString);
    if (typeof color === undefined || color === null || !color["rgba"]) {
        this.emit('error', 'Color is not recognized as a valid HTML/CSS color mapping: ' + colorString);
        return false;
    }

    this._successResponse = "DONE";
    this._successState = this._currentState;
    this._waitingForResponse = true;

    this.emit('send', ['SETCOLOR', row, column, color.rgba.join(' ')].join(' '));
    return true;
}

PanelStateMachine.prototype.setLedOnOff = function (row, column, state) {
    if (!this.__validateRow(row) || !this.__validateColumn(column)) { return false; }
    var onOff = this.__parseBoolean(state);

    this._successResponse = "DONE";
    this._successState = this._currentState;
    this._waitingForResponse = true;

    this.emit('send', [onOff ? 'ON' : 'OFF', row, column].join(' '));
    return true;
}

PanelStateMachine.prototype.setLed = function (row, column, colorString, state) {
    if (!this.__validateRow(row) || !this.__validateColumn(column)) { return false; }
    var onOff = this.__parseBoolean(state);
    var color = colorParser(colorString);
    if (typeof color === undefined || color === null || !color["rgba"]) {
        this.emit('error', 'Color is not recognized as a valid HTML/CSS color mapping: ' + colorString);
        return false;
    }

    this._successResponse = "DONE";
    this._successState = this._currentState;
    this._waitingForResponse = true;

    this.emit('send', [onOff ? 'ON' : 'OFF', row, column, color.rgba.join(' ')].join(' '));

    return true;
}

PanelStateMachine.prototype.resetLine = function (line) {
    if (!this.__validateRow(line)) { return false; }

    this._successResponse = ["OK", line].join(' ');
    this._successState = this._currentState;
    this._waitingForResponse = true;

    this.emit('send', ['RESET',line].join(' '));
    return true;
}

PanelStateMachine.prototype.stopLine = function (line, reset) {
    if (!this.__validateRow(line)) { return false; }
    var reset = this.__parseBoolean(reset, true);

    this._successResponse = ["STOPPED", line].join(' ');
    this._successState = this._currentState;
    this._waitingForResponse = true;

    this.emit('send', ['STOP',line,reset ? 1 : 0].join(' '));
    return true;
}

PanelStateMachine.prototype.turnPanelOff = function () {
    this._successResponse = "OFF";
    this._successState = this._currentState;
    this._waitingForResponse = true;

    this.emit('send', 'PANELOFF');
    return true;
}

PanelStateMachine.prototype.__validateRow = function (row) {
    if (row < 0 || row > 2) {
        this.emit('error', 'Row number must be 0, 1 or 2');
        return false;
    }

    return true;
}

PanelStateMachine.prototype.__validateColumn = function (column) {
    if (column < 0 || column > 7) {
        this.emit('error', 'Column number must be 0 - 7');
        return false;
    }

    return true;
}

PanelStateMachine.prototype.__parseBoolean = function (input, defaultValue) {
    switch((input || "").toLowerCase().trim()){
        case "true": case "yes": case "1": case "on": return true;
        case "false": case "no": case "0": case "off": return false;
        default: return defaultValue || false;
    }
}


exports.PanelStateMachine = PanelStateMachine;
module.exports = exports;