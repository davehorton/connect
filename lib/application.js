
'use strict';

/**
 * Module dependencies.
 */

const debug = require('debug')('drachtio:application');
const DrachtioAgent = require('./drachtio-agent') ;
const Emitter = require('events');
const net = require('net');
const delegate = require('delegates') ;
const methods = require('sip-methods') ;
const flatten = require('array-flatten');
const sipStatus = require('sip-status') ;


/**
 * Expose `Application` class.
 * Inherits from `Emitter.prototype`.
 */

class Application extends Emitter {
  /**
   * Initialize a new `Application`.
   *
   * @api public
   */

  constructor() {
    super();

    this.method = '*';
    this.stack = [];
    this.params = []; 
    this._cachedEvents = [] ;
    this.routedMethods = {} ;
    this.locals = Object.create(null);

    //create methods app.invite, app.register, etc..
    methods.forEach( (method) => {
      this.prototype[method.toLowerCase()] = this.prototype.use.bind( this, method.toLowerCase() ) ;   
    }) ;
  }

  listen(...args) {
    debug('listen');
    const server = net.createServer(this.callback());
    return server.listen(...args);
  }

  connect( opts ) {
    let client = new DrachtioAgent( opts, this.callback() );

    //propogate events to my listeners
    ['connect','close','error','reconnecting'].forEach( (event) => {
      client.on(event, function() {
        var args = Array.prototype.slice.call(arguments) ;
        Emitter.prototype.emit.apply(this, [event].concat(args)) ;
      }) ;
    }) ;

    //delegate some drachtio-client methods and accessors
    delegate(this, 'client')
      .method('request')
      .method('disconnect')
      .method('get')
      .method('set')
      .getter('idle') ;

    this.client = client ;
    return this ;
  }

  use(fn) {
    var offset = 0 ;
    var method = '*' ;

    // disambiguate app.use([fn])
    if (typeof fn !== 'function') {
      var arg = fn;

      while (Array.isArray(arg) && arg.length !== 0) {
        arg = arg[0];
      }

      // first arg is the method
      if (typeof arg !== 'function') {
        offset = 1;
        method = fn;
      }
    }

    var fns = flatten(Array.prototype.slice.call(arguments, offset));

    if (fns.length === 0) {
      throw new TypeError('app.use() requires middleware functions');
    }

    fns.forEach( (fn) => {
      // wrap sub-apps
      if ('function' === typeof fn.handle) {
        var server = fn;
        fn.method = method;
        fn = function(req, res, next){
          server.handle(req, res, next);
        };
      }

      debug('use %s %s', method || '*', fn.name || 'anonymous');
      this.stack.push({ method: method, handle: fn });
    }) ;

    if( typeof method === 'string' && method !== '*' && !(method in this.routedMethods)) {
      this.routedMethods[method] = true ;
      if( this.client ) { 
        this.client.route(method) ; 
      }
    }

    return this;
  }

  /**
   * Handle server requests, punting them down
   * the middleware stack.
   *
   * @api private
   */

  handle(req, res, out) {
    var stack = this.stack ;
    var index = 0;

    debug('handling request with method %s', req.method);
    req.app = this ;

    function next(err) {
      var layer;

      // next callback
      layer = stack[index++];

      // all done
      if (!layer || res.finalResponseSent) {
        // delegate to parent
        if (out) { return out(err); }

        // unhandled error
        if (err) {
          // default to 500
          var finalResponseSent = res.finalResponseSent ;

          console.error(`some layer barfed an error: ${err.message || err}`) ;
          if (res.status < 400 || !req.status) { res.status = 500; }
          debug(`default ${res.status}`);

          // respect err.status
          if (err.status) { res.status = err.status; }

          // production gets a basic error message
          var msg = sipStatus[res.status] ;

          // log to stderr in a non-test env
          console.error(err.stack || err.toString());
          if (finalResponseSent) { return ; }
          res.send(res.status, msg);
        } else {
          if( req.method === 'PRACK' ) {
            res.send(200);
          }
          else if( req.method !== 'ACK' ) {
            res.send(404) ;
          }
        }
        return;
      }

      try {

        // skip this layer if the route doesn't match.
        if (0 !== req.method.toLowerCase().indexOf(layer.method.toLowerCase()) && layer.method !== '*') { return next(err); }

        debug('%s %s : %s', layer.handle.name || 'anonymous', layer.method, req.uri);
        var arity = layer.handle.length;
        if (err) {
          if (arity === 4) {
            layer.handle(err, req, res, next);
          } else {
            next(err);
          }
        } else if (arity < 4) {
          layer.handle(req, res, next);
        } else {
          next();
        }
      } catch (e) {
        console.error(e.stack) ;
        next(e);
      }
    }
    next();
  }

  /**
   * Return a request handler callback
   * for node's native http server.
   *
   * @return {Function}
   * @api public
   */

  callback() {

    const handleRequest = (req, res, next) => { 
      this.handle(req, res, next); 
    } ;

    return handleRequest;

  }

  /**
   * Initialize a new context.
   *
   * @api private
   */


}



module.exports = Application ;
