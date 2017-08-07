const Emitter = require('events');
const debug = require('debug')('drachtio:agent');
const WireProtocol = require('./wire-protocol') ;
const SipMessage = require('drachtio-sip').SipMessage ;
const Request = require('./request') ;
const Response = require('./response') ;
const DigestClient = require('./digest-client') ;
const noop = require('node-noop').noop;
const winston = require('winston') ;
const assert = require('assert');
const net = require('net');
const delegate = require('delegates') ;
const CR = '\r' ;
const CRLF = '\r\n' ;

const defer = typeof setImmediate === 'function' ?
  setImmediate : function(fn) { process.nextTick(fn.bind.apply(fn, arguments)); } ;

class DrachtioAgent extends Emitter {

  constructor(callback) {
    super();

    this.puntUpTheMiddleware = callback ;
    this.params = new Map() ;

    this.mapServer = new Map() ;
    this.verbs = new Map() ;
    this.cdrHandlers = new Map() ;
  }

  get idle() {

    let pendingCount = 0 ;
    let pendingSipCount = 0 ;
    let pendingAckOrPrack = 0 ;

    this.mapServer.forEach((obj, socket) => {
      pendingCount += obj.pendingRequests.size ;
      pendingSipCount += obj.pendingSipRequests.size ;
      pendingAckOrPrack += obj.pendingAckOrPrack.size ;

      if (pendingCount > 0) {
        debug(`count of pending requests: ${pendingCount}`) ;
        for (const key of obj.pendingRequests.keys()) {
          debug(key);
        }
      }
      if (pendingSipCount > 0) {
        debug(`count of pending sip requests: ${pendingSipCount}`) ;
        for (const key of obj.pendingSipRequests.keys()) {
          debug(key);
        }
      }
      if (pendingAckOrPrack > 0) {
        debug(`count of pending ack/prack: ${pendingAckOrPrack}`) ;
        for (const key of obj.pendingAckOrPrack.keys()) {
          debug(key);
        }
      }

    });

    debug(`idle check: ${pendingCount + pendingSipCount + pendingAckOrPrack}`);
    return (pendingCount + pendingSipCount + pendingAckOrPrack) === 0 ;
  }

  connect(opts, callback) {
    this.secret = opts.secret ;

    if (this._logger) {
      opts.logger = this._logger ;
    }

    this.wp = new WireProtocol(opts) ;
    this.wp.connect(opts);

    // pass on some of the socket events
    ['reconnecting', 'close', 'error'].forEach((evt) => {
      this.wp.on(evt, (...args) => {
        this.emit(evt, ...args);
      }) ;
    }) ;

    this.wp.on('connect', this._onConnect.bind(this)) ;
    this.wp.on('msg', this._onMsg.bind(this)) ;

    if (callback) {
      Emitter.prototype.on.call(this, 'connect', callback);
    }
  }

  listen(opts, callback) {
    this.secret = opts.secret ;

    if (this._logger) {
      opts.logger = this._logger ;
    }

    this.wp = new WireProtocol(opts) ;
    this.wp.listen(opts);

    delegate(this, 'wp')
      .method('close') ;


    // pass on some of the socket events
    ['reconnecting', 'close', 'error', 'listening'].forEach((evt) => {
      this.wp.on(evt, (...args) => {
        this.emit(evt, ...args);
      }) ;
    }) ;

    this.wp.on('connection', this._onConnect.bind(this)) ;
    this.wp.on('msg', this._onMsg.bind(this)) ;

    if (callback) {
      Emitter.prototype.on.call(this, 'listening', callback);
    }
  }

  on(event, fn) {

    //cdr events are handled through a different mechanism - we register with the server
    if (0 === event.indexOf('cdr:')) {
      this.cdrHandlers.set(event.slice(4), fn) ;
      this.route(event) ;
    }
    else {
      //delegate to EventEmitter
      Emitter.prototype.on.apply(this, arguments);
    }
    return this ;
  }

  sendMessage(socket, msg, opts) {
    if (!(socket instanceof net.Socket)) {
      opts = msg;
      msg = socket ;
      socket =  this._getDefaultSocket() ;
    }

    debug(`sendMessage: ${msg}`);
    let m = msg ;
    opts = opts || {} ;

    debug(`opts: ${JSON.stringify(opts)}`);

    if (opts && (opts.headers || opts.body)) {
      m = new SipMessage(msg) ;
      for (const hdr in (opts.headers || {})) {
        m.set(hdr, opts.headers[hdr]) ;
      }
      if (opts.body) { m.body = opts.body ; }
    }

    const s = `sip|${opts.stackTxnId || ''}|${opts.stackDialogId || ''}${CRLF}${m.toString()}`;

    return this.wp.send(socket, s) ;
  }

  _normalizeParams(socket, uri, options, callback) {
    if (!(socket instanceof net.Socket)) {
      callback = options ;
      options = uri ;
      uri = socket ;
      socket = this._getDefaultSocket() ;
    }

    if (typeof uri === 'undefined') {
      const err = new Error('undefined is not a valid request_uri or options object.') ;
      console.error(err.stack) ;
      throw err ;
    }

    // request( request_uri, options, callback, ..)
    if (options && typeof options === 'object') {
      options.uri = uri ;
    }
    // request( request_uri, callback, ..)
    else if (typeof uri === 'string') {
      options = {uri:uri } ;
    }
    // request( option, callback, ..)
    else {
      callback = options ;
      options = uri ;
      uri = options.uri;
    }
    callback = callback || noop ;

    debug(`options: ${JSON.stringify(options)}`);
    options.method = options.method.toUpperCase() ;

    return { socket, uri, options, callback } ;
  }

  _makeRequest(params) {
    const obj = this.mapServer.get(params.socket) ;

    //allow for requests within a dialog, where caller does not need to supply a uri
    if (!params.options.uri && !!params.options.stackDialogId) {
      params.options.uri = 'sip:placeholder' ;
    }

    const m = new SipMessage(params.options) ;

    //new outgoing request
    const msg = `sip|${params.options.stackTxnId || ''}|${params.options.stackDialogId || ''}${CRLF}${m.toString()}` ;
    var msgId = this.wp.send(params.socket, msg) ;

    obj.pendingRequests.set(msgId, (token, msg) => {
      if (token[0] === 'OK') {
        var transactionId = token[7] ;
        var meta = {
          source: token[1],
          address: token[4],
          port: token[5],
          protocol: token[3],
          time: token[6],
          transactionId: transactionId
        } ;

        var req = new Request(new SipMessage(msg), meta) ;
        req.agent = this ;
        req.socket = obj.socket ;
        if (params.options.auth) {
          req.auth = params.options.auth ;
          req._originalParams = params ;
        }

        //Note: unfortunately, sofia (the nta layer) does not pass up the 200 OK response to a CANCEL
        //so we are unable to route it up to the application.
        //Therefore, we can't allocate this callback since it would never be called or freed
        if (params.options.method !== 'CANCEL') {
          obj.pendingSipRequests.set(transactionId,  {
            req: req
          }) ;
        }

        params.callback(null, req) ;

      }
      else {
        params.callback(token[1] || 'request failed') ;
      }
    });
  }

  request(socket, request_uri, options, callback) {
    const params = this._normalizeParams(socket, request_uri, options, callback) ;
    return this._makeRequest(params) ;
  }

  sendResponse(res, opts, callback, fnAck) {
    const obj = this.mapServer.get(res.socket) ;
    debug(`agent#sendResponse: ${JSON.stringify(res.msg)}`);
    const msgId = this.sendMessage(res.socket, res.msg, Object.assign({stackTxnId: res.req.stackTxnId}, opts)) ;
    if (callback || fnAck) {

      obj.pendingRequests.set(msgId, (token, msg, meta) => {
        obj.pendingRequests.delete(msgId) ;
        if ('OK' !== token[0]) { return callback(token[1]) ; }
        const responseMsg = new SipMessage(msg) ;
        res.meta = meta ;
        if (callback) {
          callback(null, responseMsg) ;
        }

        // for reliable provisional responses or does caller want to be notified on receipt of prack / ack ?
        if (fnAck && typeof fnAck === 'function' &&
          (responseMsg.has('RSeq') || res.status === 200)) {
          obj.pendingAckOrPrack.set(meta.dialogId, fnAck) ;
        }
      }) ;
    }
    if (res.statusCode >= 200) {
      defer(() => {
        res.finished = true ;
        res.emit('finish');
      });

      // clear out pending incoming INVITEs when we send a final response
      if (res.req.method === 'INVITE') {
        const callId = res.get('call-id') ;
        obj.pendingNetworkInvites.delete(callId) ;
        debug(`Agent#sendResponse: deleted pending invite for call-id ${callId}, ` +
          `there are now ${obj.pendingNetworkInvites.size} pending invites`);
      }
    }
  }

  sendAck(method, dialogId, req, res, opts, callback) {
    assert(this.mapServer.has(res.socket));
    const obj = this.mapServer.get(res.socket) ;
    const m = new SipMessage() ;
    m.method = method ;
    m.uri = req.uri ;
    opts = opts || {} ;

    Object.assign(opts, {stackDialogId: dialogId}) ;

    const msgId = this.sendMessage(res.socket, m, opts) ;
    if (callback) {
      obj.pendingRequests.set(msgId, (token, msg, meta) => {
        if ('OK' !== token[0]) {
          return callback(token[1]) ;
        }
        callback(null, new SipMessage(msg)) ;
      }) ;
    }
  }

  proxy(req, opts, callback) {
    const obj = this.mapServer.get(req.socket) ;

    var m = new SipMessage({
      uri: opts.destination[0],
      method: req.method
    }) ;

    if (opts.headers) {
      for (var hdr in (opts.headers || {})) {
        m.set(hdr, opts.headers[hdr]) ;
      }
    }

    const msg = `proxy|${opts.stackTxnId}|${(opts.remainInDialog ? 'remainInDialog' : '')}` +
    `|${(opts.fullResponse ? 'fullResponse' : '')}|${(opts.followRedirects ? 'followRedirects' : '')}` +
    `|${(opts.simultaneous ? 'simultaneous' : 'serial')}|${opts.provisionalTimeout}|${opts.finalTimeout}` +
    `|${opts.destination.join('|')}${CRLF}${m.toString()}` ;

    var msgId = this.wp.send(req.socket, msg) ;
    obj.pendingRequests.set(msgId, callback) ;
  }

  set(prop, val) {

    switch (prop) {
      case 'api logger':
        if (val) {
          const opts = {} ;
          opts['string' === typeof val ? 'filename' : 'stream'] = val ;

          const c = new winston.Container({
            transports: [
              new (winston.transports.File)(opts)
            ]
          }) ;
          this._logger = c.add('default').info ;

          if (this.wp) {
            this.wp.setLogger(this._logger) ;
          }
        }
        else {
          this._logger = null ;
          if (this.wp) {
            this.wp.removeLogger() ;
          }
        }
        break ;
      case 'handler':
        this.puntUpTheMiddleware = val ;
        break ;

      default:
        this.params.set(prop, val) ;
        break ;
    }
  }

  get(prop) {
    return this.params.get(prop) ;
  }

  route(verb) {
    if (this.verbs.has(verb)) { throw new Error('duplicate route request for ' + verb) ; }
    this.verbs.set(verb,  {sent: false }) ;

    this.mapServer.forEach((obj, socket) => {
      if (obj.authenticated) {
        this.routeVerbs(socket) ;
      }
    });
  }

  routeVerbs(socket) {
    this.verbs.forEach((obj, verb) => {
      if (obj.sent === true) {
        return ;
      }

      obj = {
        sent: true,
        acknowledged: false,
        rid: this.wp.send(socket, 'route|' + verb)
      } ;
    });
  }

  disconnect(socket) {
    this.wp.disconnect(socket || this._getDefaultSocket()) ;
  }
  close() {
    this.wp.close() ;
  }

  _getDefaultSocket() {
    return this.mapServer.keys().next().value ;
  }
  _initServer(socket) {
    assert(!this.mapServer.has(socket));
    this.mapServer.set(socket, {
      //any request message awaiting a response from a drachtio server
      pendingRequests: new Map(),
      //any sip request generated by us awaiting a final response from a drachtio server
      pendingSipRequests: new Map(),
      //any sip request generated by us that we are resending with Authorization header
      pendingSipAuthRequests: new Map(),
      //any sip INVITE we've received that we've not yet generated a final response for
      pendingNetworkInvites: new Map(),
      // a reliable provisional response or 200 OK to INVITE that is waiting on a PRACK/ACK
      pendingAckOrPrack: new Map(),
      authenticated: false,
      ready: false,
      hostport: null
    });
    return this.mapServer.get(socket);
  }

  _onConnect(socket) {
    const obj = this._initServer(socket) ;
    const msgId = this.wp.send(socket, `authenticate|${this.secret}|${(this.label || 'default')}`) ;
    obj.pendingRequests.set(msgId, (response) => {
      if (obj.authenticated = ('OK' === response[0])) {
        obj.ready = true ;
        obj.hostport = response[1] ;
        debug('sucessfully authenticated, hostport is ', obj.hostport) ;

        if (this.wp.isClient) {
          this.routeVerbs(socket, obj) ;
        }

        //hack: attempt to have our route requests go through before we announce we're connected
        //not sure this is relevant for production, but in test scenarios we fire into tests as
        //soon as connected, and in the case of the cdr tests we got intermittent failures resulting
        //from not having routed cdr:start etc before the calls started arriving
        const self = this ;
        setTimeout(() => {
          self.emit('connect', null, obj.hostport, socket) ;
        }, 100) ;

      }
      else {
        this.emit('connect', new Error('failed to authenticate to server')) ;
      }
    }) ;
  }

  _onMsg(socket, msg) {
    const obj = this.mapServer.get(socket) ;
    const pos = msg.indexOf(CR) ;
    const leader = -1 === pos ? msg : msg.slice(0, pos) ;
    const token = leader.split('|') ;
    let res, sr, rawMsg ;

    switch (token[1]) {
      case 'sip':
        rawMsg = msg.slice(pos + 2) ;
        const sipMsg = new SipMessage(rawMsg) ;
        const source = token[2] ;
        const protocol = token[4] ;
        const address = token[5] ;
        const port = token[6] ;
        const time = token[7] ;
        const transactionId = token[8] ;
        const dialogId = token[9] ;
        const meta = { source, address, port, protocol, time, transactionId, dialogId } ;
        debug(`tokens: ${JSON.stringify(token)}`);

        if (token.length > 9) {

          if ('network' === source && sipMsg.type === 'request') {

            //handle CANCELS by locating the associated INVITE and emitting a 'cancel' event
            var callId = sipMsg.get('call-id') ;
            if ('CANCEL' === sipMsg.method && obj.pendingNetworkInvites.has(callId)) {
              obj.pendingNetworkInvites.get(callId).req.emit('cancel') ;
              obj.pendingNetworkInvites.delete(callId) ;
              debug(`Agent#handle - emitted cancel event for INVITE with call-id ${callId}` +
                `, remaining count of invites in progress: ${obj.pendingNetworkInvites.size}`);
              return ;
            }

            debug(`DrachtioAgent#_onMsg: meta: ${JSON.stringify(meta)}`);

            var req = new Request(sipMsg, meta) ;
            res = new Response() ;
            req.res = res ;
            res.req = req ;
            req.agent = res.agent = this ;
            req.socket = res.socket = socket ;

            if ('INVITE' === req.method) {
              obj.pendingNetworkInvites.set(callId, { req, res }) ;
              debug(`Agent#handle: tracking an incoming invite with call-id ${callId}, ` +
                `currently tracking ${obj.pendingNetworkInvites.size} invites in progress`);
            }
            else if (('PRACK' === req.method || 'ACK' === req.method) && obj.pendingAckOrPrack.has(dialogId)) {
              var fnAck = obj.pendingAckOrPrack.get(dialogId);
              obj.pendingAckOrPrack.delete(dialogId);
              fnAck() ;
            }

            this.puntUpTheMiddleware(req, res) ;
          }
          else if ('network' === source) {
            debug('received sip response');
            if (obj.pendingSipRequests.has(transactionId)) {
              sr = obj.pendingSipRequests.get(transactionId) ;
              res = new Response(this) ;
              res.msg = sipMsg ;
              res.meta = meta ;
              res.req = sr.req ;
              res.socket = res.req.socket = socket ;

              debug('Agent#handle: got a response with status: %d', res.status) ;

              if (res.status >= 200) {
                obj.pendingSipRequests.delete(transactionId)  ;
              }

              //prepare a function to be called for prack or ack, if appropriate
              var ack = noop ;
              if (res.status >= 200 && res.req.method === 'INVITE') {
                ack = Response.prototype.sendAck.bind(res, token[9]) ;
              }
              else if (res.status > 100 && res.status < 200) {
                var prackNeeded = res.get('RSeq');
                if (prackNeeded) {
                  ack = Response.prototype.sendPrack.bind(res, token[9]) ;
                }
              }
              // If its a challenge and the user supplied username and password, automatically handle it
              var cid = res.msg.headers['call-id'];
              if (obj.pendingSipAuthRequests.has(cid)) {
                obj.pendingSipAuthRequests.delete(cid) ;

              }
              else if ((401 === res.status || 407 === res.status) && (!!res.req.auth)) {
                obj.pendingSipAuthRequests.set(cid, true) ;
                var client = new DigestClient(res) ;
                client.authenticate((err, req) => {
                  // move all listeners from the old request to the new one we just generated
                  res.req.listeners('response').forEach((l) => { req.on('response', l) ; }) ;
                  res.req.emit('authenticate', req) ;
                }) ;
                return ;
              }
              sr.req.emit('response', res, ack) ;
            }
          }
        }

        break ;

      case 'response':
        var rId = token[2] ;
        if (obj.pendingRequests.has(rId)) {
          if (-1 !== pos) { rawMsg = msg.slice(pos + 2) ; }
          var meta2 = {
            source: token[4],
            address: token[7],
            port: token[8],
            protocol: token[6],
            time: token[9],
            transactionId: token[10],
            dialogId: token[11]
          } ;
          var fn = obj.pendingRequests.get(rId).bind(this, token.slice(3), rawMsg, meta2) ;
          if ('continue' !== token[12]) {
            obj.pendingRequests.delete(rId) ;
          }
          fn() ;
        }
        break ;

      case 'cdr:attempt':
      case 'cdr:start':
      case 'cdr:stop':
        var cdrEvent = token[1].slice(4)  ;
        var msgSource = token[2] ;
        var msgTime = token[3] ;
        rawMsg = msg.slice(pos + 2) ;
        var cdrSipMsg = new SipMessage(rawMsg) ;
        var args = [msgSource, msgTime] ;
        if (cdrEvent !== 'attempt') { args.push(token[4]) ; }
        args.push(cdrSipMsg) ;

        if (this.cdrHandlers.has(cdrEvent)) {
          this.cdrHandlers.get(cdrEvent).apply(this, args) ;
        }
        break ;

      default:
        throw new Error('unexpected message with type: ' + token[1]) ;
    }
  }
}

DrachtioAgent.prototype.uac = DrachtioAgent.prototype.request ; // alias

module.exports = DrachtioAgent ;