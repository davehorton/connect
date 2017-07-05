const Emitter = require('events');
const net = require('net');
const uuidV4 = require('uuid/v4') ;
const debug = require('debug')('drachtio:agent');
const noop = require('node-noop').noop;
const CRLF = '\r\n' ;

module.exports = class WireProtocol extends Emitter {

  constructor(opts) {
    super() ;

    this.host = opts.host ;
    this.port = opts.port ;
    this.reconnectOpts = opts.reconnect || {} ;
    this.reconnectVars = {} ;
    this.connected = false ;
    this._logger = opts.logger || noop ;
    this.incomingMsg = '' ;

    debug(`wp connecting to ${this.host}:${this.port}`);
    this.socket = net.connect({
      port: opts.port,
      host: opts.host
    }) ;

    this.socket.setKeepAlive(true);
    this.installListeners() ;
  }

  setLogger(logger) {
    this._logger = logger ;
  }
  removeLogger() {
    this._logger = function() {} ;
  }

  installListeners() {
    this.socket.setEncoding('utf8') ;

    this.socket.on('error', (err) => {
      debug(`wp#on error - ${err} ${this.host}:${this.port}`);

      this.connected = false;
      if (this.closing) {
        return;
      }

      this.emit('error', err);

      // "error" events get turned into exceptions if they aren't listened for.  If the user handled this error
      // then we should try to reconnect.
      this._onConnectionGone();
    });

    this.socket.on('connect', () => {
      debug(`wp#on connect ${this.host}:${this.port}`);
      this.connected = true ;
      this.initializeRetryVars() ;
      this.emit('connect');
    }) ;

    this.socket.on('close', () => {
      debug(`wp#on close ${this.host}:${this.port}`);
      this.connected = false;
      this._onConnectionGone();
      this.emit('close') ;
    }) ;

    this.socket.on('data', this._onData.bind(this)) ;
  }

  initializeRetryVars() {
    this.reconnectVars.retryTimer = null;
    this.reconnectVars.retryTotaltime = 0;
    this.reconnectVars.retryDelay = 150;
    this.reconnectVars.retryBackoff = 1.7;
    this.reconnectVars.attempts = 1;
  }

  _onConnectionGone() {

    // If a retry is already in progress, just let that happen
    if (this.reconnectVars.retryTimer) {
      debug('WireProtocol#connection_gone: retry is already in progress') ;
      return;
    }

    // If this is a requested shutdown, then don't retry
    if (this.closing) {
      this.reconnectVars.retryTimer = null;
      return;
    }

    const nextDelay = Math.floor(this.reconnectVars.retryDelay * this.reconnectVars.retryBackoff);
    if (this.reconnectOpts.retryMaxDelay !== null && nextDelay > this.reconnectOpts.retryMaxDelay) {
      this.reconnectVars.retryDelay = this.reconnectOpts.retryMaxDelay;
    } else {
      this.reconnectVars.retryDelay = nextDelay;
    }

    if (this.reconnectOpts.maxAttempts && this.reconnectVars.attempts >= this.reconnectOpts.maxAttempts) {
      this.reconnectVars.retryTimer = null;
      return;
    }

    this.reconnectVars.attempts += 1;
    this.emit('reconnecting', {
      delay: this.reconnectVars.retryDelay,
      attempt: this.reconnectVars.attempts
    });
    this.reconnectVars.retryTimer = setTimeout(() => {
      this.reconnectVars.retryTotaltime += this.reconnectVars.retryDelay;

      if (this.reconnectOpts.connectTimeout && this.reconnectVars.retryTotaltime >= this.reconnectOpts.connectTimeout) {
        this.reconnectVars.retryTimer = null;
        console.error('WireProtocol#connection_gone: ' +
          `Couldn't get drachtio connection after ${this.reconnectVars.retryTotaltime} ms`);
        return;
      }
      this.socket = net.connect({
        port: this.port,
        host: this.host
      }) ;
      this.socket.setKeepAlive(true) ;
      this.installListeners() ;

      this.reconnectVars.retryTimer = null;
    }, this.reconnectVars.retryDelay);

  }

  send(msg) {
    const msgId = uuidV4() ;
    const s = msgId + '|' + msg ;
    this.socket.write(s.length + '#' + s, () => {
      debug(`wp#send ${this.host}:${this.port} - ${s.length}#${s}`);
    }) ;
    this._logger('===>' + CRLF + s.length + '#' + s + CRLF) ;
    return msgId ;
  }

  parseMessageHeader(msg, hashPosition) {
    var len = parseInt(msg.slice(0, hashPosition)) ;
    if (isNaN(len)) { throw new Error('invalid length for message: ' + msg) ; }

    this.incomingMsgLength = len ;
    const start = ++hashPosition;
    const end = start + len ;
    this.incomingMsg += msg.slice(start, end) ;
    msg = msg.length === (end + 1) ? '' : msg.slice(hashPosition + len) ;
    return msg ; //return remainder to use for next message
  }


  _onData(msg) {
    this._logger('<===' + CRLF + msg + CRLF) ;

    while (msg.length > 0) {
      let pos ;
      if (0 === this.incomingMsg.length) {
        //waiting for a new message
        pos = msg.indexOf('#') ;
        if (-1 === pos) {
          if (msg.match(/^\\d+$/)) {
            //it can happen that a message is broken between the length digits and '#'
            this.incomingMsg = msg ;
            this.incomingMsgLength = -1 ;  //unknown
            return ;
          }
          else {
            throw new Error('invalid message from server, did not start with length#: ' + msg) ;
          }
        }
        msg = this.parseMessageHeader(msg, pos);
      }
      else if (-1 === this.incomingMsgLength) {
        //got a length fragment last time
        this.incomingMsg += msg ;
        pos = msg.indexOf('#') ;
        if (-1 === pos) {
          //cant split twice in a length fragment
          throw new Error('invalid message from server, did not start with length#: ' +
            msg) ;
        }
        msg = this.parseMessageHeader(msg, pos) ;
      }
      else {
        //got a fragment last time
        var remainderSize = this.incomingMsgLength - this.incomingMsg.length ;
        this.incomingMsg += msg.slice(0, remainderSize) ;
        msg = msg.slice(remainderSize) ;
      }

      //if we've got a full message, process it
      if (this.incomingMsg.length === this.incomingMsgLength) {
        debug(`WireProtocol#_onData: got message ${this.incomingMsg}`);
        this.emit('msg', this.incomingMsg) ;
        this.incomingMsg = '' ;
      }
    }
  }

  disconnect() {
    this.closing = true ;
    if (!this.socket) { throw new Error('socket is not connected') ; }
    this.socket.end() ;
  }

} ;
