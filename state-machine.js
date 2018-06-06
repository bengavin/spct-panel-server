const EventEmitter = require('events').EventEmitter;
const util = require('util');

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

exports.PanelStateMachine = PanelStateMachine;
module.exports = exports;