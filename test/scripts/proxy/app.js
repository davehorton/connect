var drachtio = require('../../..') ;
var fs = require('fs') ;
var assert = require('assert'); 
var debug = require('debug')('test:invite-proxy') ;

module.exports = function( config ) {

  var app = drachtio() ;
  app.set('api logger',fs.createWriteStream(config.apiLog) ) ;

  debug(`proxy config: ${JSON.stringify(config)}`);
  if (config.testPromise === true) {
    debug('doing promises-based version');
    app.invite( function( req, res ){
      req.proxy({
        remainInDialog: config.remainInDialog,
        destination: config.proxyTarget,
        followRedirects: config.followRedirects,
        provisionalTimeout: config.provisionalTimeout,
        finalTimeout: config.finalTimeout,
        forking: config.forking,
        headers: {
          'Subject': req.get('Subject') || 'unnamed test'
        }
      })
        .then((results) => {
          assert(app.idle); 
          app.disconnect() ;                
        })
       .catch((err) => {
        throw err;
       })
    }) ;    
  }
  else {
    app.invite( function( req, res ){
      req.proxy({
        remainInDialog: config.remainInDialog,
        destination: config.proxyTarget,
        followRedirects: config.followRedirects,
        provisionalTimeout: config.provisionalTimeout,
        finalTimeout: config.finalTimeout,
        forking: config.forking,
        headers: {
          'Subject': req.get('Subject') || 'unnamed test'
        }
      }, function(err, results){
          assert( app.idle ); 
          app.disconnect() ;                
      }) ;
    }) ;    
  }

  app.connect(config.connect_opts) ;

  return app ;
} ;




