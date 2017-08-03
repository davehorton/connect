const Emitter = require('events');
const net = require('net');
const uuidV4 = require('uuid/v4') ;
const debug = require('debug')('drachtio:agent');
const noop = require('node-noop').noop;
const CRLF = '\r\n' ;
const assert = require('assert');

module.exports = class WireProtocol extends Emitter {

  constructor(opts) {
    super() ;

    this._logger = opts.logger || noop ;
    this.mapIncomingMsg = new Map() ;

    if (opts.host) {
      this.host = opts.host ;
      this.port = opts.port ;
      this.reconnectOpts = opts.reconnect || {} ;
      this.reconnectVars = {} ;
      debug(`wp connecting to ${this.host}:${this.port}`);
      const socket = net.connect({
        port: opts.port,
        host: opts.host
      }) ;

      socket.setKeepAlive(true);
      this.installListeners(socket) ;
    }
    else {
      this.listenPort = typeof opts === 'number' ? opts : opts.listenPort ;
      assert.ok(typeof this.listenPort === 'number',
        'WireProtocol constructor requires a listen port for host to connect to');

      this.server = net.createServer((socket) => {
        this.installListeners(socket) ;
      });
      const opts = {
        port: this.listenPort,
      } ;
      if (opts.listenAddress) {
        opts.host = opts.listenAddress ;
      }
      this.server.listen(opts);
    }
  }

  get isServer() {
    return this.server ;
  }

  get isClient() {
    return !this.server ;
  }

  setLogger(logger) {
    this._logger = logger ;
  }
  removeLogger() {
    this._logger = function() {} ;
  }

  installListeners(socket) {
    socket.setEncoding('utf8') ;

    socket.on('error', (err) => {
      debug(`wp#on error - ${err} ${this.host}:${this.port}`);

      if (this.isServer || this.closing) {
        return;
      }

      this.emit('error', err, socket);

      // "error" events get turned into exceptions if they aren't listened for.  If the user handled this error
      // then we should try to reconnect.
      this._onConnectionGone();
    });

    socket.on('connect', () => {
      debug(`wp#on connect ${this.host}:${this.port}`);
      if (this.isClient) {
        this.initializeRetryVars() ;
      }
      this.emit('connect', socket);
    }) ;

    socket.on('close', () => {
      debug(`wp#on close ${this.host}:${this.port}`);
      if (this.isClient) {
        this._onConnectionGone();
      }
      this.mapIncomingMsg.delete(socket) ;
      this.emit('close', socket) ;
    }) ;

    socket.on('data', this._onData.bind(this, socket)) ;
  }

  initializeRetryVars() {
    assert(this.isClient);

    this.reconnectVars.retryTimer = null;
    this.reconnectVars.retryTotaltime = 0;
    this.reconnectVars.retryDelay = 150;
    this.reconnectVars.retryBackoff = 1.7;
    this.reconnectVars.attempts = 1;
  }

  _onConnectionGone() {
    assert(this.isClient);

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

  send(socket, msg) {
    const msgId = uuidV4() ;
    const s = msgId + '|' + msg ;
    socket.write(s.length + '#' + s, () => {
      debug(`wp#send ${this.host}:${this.port} - ${s.length}#${s}`);
    }) ;
    this._logger('===>' + CRLF + s.length + '#' + s + CRLF) ;
    return msgId ;
  }

  parseMessageHeader(msg, hashPosition, obj) {
    var len = parseInt(msg.slice(0, hashPosition)) ;
    if (isNaN(len)) { throw new Error('invalid length for message: ' + msg) ; }

    obj.incomingMsgLength = len ;
    const start = ++hashPosition;
    const end = start + len ;
    obj.incomingMsg += msg.slice(start, end) ;
    msg = msg.length === (end + 1) ? '' : msg.slice(hashPosition + len) ;
    return msg ; //return remainder to use for next message
  }


  _onData(socket, msg) {
    this._logger('<===' + CRLF + msg + CRLF) ;

    if (!this.mapIncomingMsg.has(socket)) {
      this.mapIncomingMsg.set(socket, {
        incomingMsg: '',
        length: -1
      });
    }
    const obj = this.mapIncomingMsg.get(socket) ;

    while (msg.length > 0) {
      let pos ;
      if (0 === obj.incomingMsg.length) {
        //waiting for a new message
        pos = msg.indexOf('#') ;
        if (-1 === pos) {
          if (msg.match(/^\\d+$/)) {
            //it can happen that a message is broken between the length digits and '#'
            obj.incomingMsg = msg ;
            obj.incomingMsgLength = -1 ;  //unknown
            return ;
          }
          else {
            throw new Error('invalid message from server, did not start with length#: ' + msg) ;
          }
        }
        msg = this.parseMessageHeader(msg, pos, obj);
      }
      else if (-1 === obj.incomingMsgLength) {
        //got a length fragment last time
        obj.incomingMsg += msg ;
        pos = msg.indexOf('#') ;
        if (-1 === pos) {
          //cant split twice in a length fragment
          throw new Error('invalid message from server, did not start with length#: ' +
            msg) ;
        }
        msg = this.parseMessageHeader(msg, pos, obj) ;
      }
      else {
        //got a fragment last time
        var remainderSize = obj.incomingMsgLength - obj.incomingMsg.length ;
        obj.incomingMsg += msg.slice(0, remainderSize) ;
        msg = msg.slice(remainderSize) ;
      }

      //if we've got a full message, process it
      if (obj.incomingMsg.length === obj.incomingMsgLength) {
        debug(`WireProtocol#_onData: got message ${this.incomingMsg}`);
        this.emit('msg', socket, obj.incomingMsg) ;
        obj.incomingMsg = '' ;
        obj.incomingMsgLength = -1;
      }
    }
  }

  disconnect(socket) {
    this.closing = true ;
    this.mapIncomingMsg.delete(socket);
    if (!socket) { throw new Error('socket is not connected or was not provided') ; }
    socket.end() ;
  }

} ;
