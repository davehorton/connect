var sipStatus = require('sip-status') ;
var debug = require('debug')('connect:dispatcher');
var Agent = require('./client').Agent ;
var EventEmitter = require('events').EventEmitter ;
var flatten = require('array-flatten');
var delegate = require('delegates') ;
var slice = Array.prototype.slice ;

var app = module.exports = {};

app.connect = function() {
  var self = this ;
  var client = new Agent( this );
  for( var prop in this.params ) {
    client.set(prop, this.params[prop]) ;
  }
  for( var method in this.routedMethods ) {
    client.route( method ) ;
  }

  //propogate drachtio-client events to my listeners
  ['connect','close','error','reconnecting'].forEach( function(event){
    client.on(event, function() {
      var args = Array.prototype.slice.call(arguments) ;
      EventEmitter.prototype.emit.apply(self, [event].concat(args)) ;
    }) ;
  }) ;

  this._cachedEvents.forEach( function(event){
    app.on(event); 
  }) ;
  this._cachedEvents = [] ;

  //delegate some drachtio-client methods and accessors
  delegate(this, 'client')
    .method('request')
    .method('disconnect')
    .method('get')
    .method('set')
    .getter('idle') ;

  client.connect.apply(client, arguments);
  this.client = client ;
  return this ;
};

app.request = function() {
  throw new Error('cannot call app#request in unconnected state') ;
} ;

app.set = function( prop, value ) {
  this.params[prop] = value ;
};

app.get = function( prop ) {
  return this.params[prop] ;
};


/**
 * Utilize the given middleware `handle` to the given `method`,
 * defaulting to _*_, which means execute for all methods. 
 *
 * @param {String|Function} method or callback 
 * @param {Function} callback 
 * @return {Server} for chaining
 * @api public
 */

app.use = function(fn){
  var self = this ;
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

  var fns = flatten(slice.call(arguments, offset));

  if (fns.length === 0) {
    throw new TypeError('app.use() requires middleware functions');
  }

  fns.forEach(function (fn) {
    // wrap sub-apps
    if ('function' === typeof fn.handle) {
      var server = fn;
      fn.method = method;
      fn = function(req, res, next){
        server.handle(req, res, next);
      };
    }

    debug('use %s %s', method || '*', fn.name || 'anonymous');
    self.stack.push({ method: method, handle: fn });
  }) ;

  if( typeof method === 'string' && method !== '*' && !(method in this.routedMethods)) {
    this.routedMethods[method] = true ;
    if( this.client ) { this.client.route(method) ; }
  }

  return this;
};

/**
 * Handle server requests, punting them down
 * the middleware stack.
 *
 * @api private
 */

app.handle = function(req, res, out) {
  var stack = this.stack ;
  var index = 0;

  debug('handling request with method %s', req.method);

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

        console.error('some layer barfed an error: ', err) ;
        if (res.status < 400 || !req.status) { res.status = 500; }
        debug('default %s', res.status);

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
};
