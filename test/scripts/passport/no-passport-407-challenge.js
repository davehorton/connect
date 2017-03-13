'use strict';
var drachtio = require('../../..') ;
var fs = require('fs') ;
var assert = require('assert') ;
var i = 0 ;
module.exports = function( config ) {

  var app = drachtio() ;


  app.invite( function(req,res){
    if( i++ === 0 ) {
      res.send(407, {
        headers: {
          'Proxy-Authenticate': ' Digest realm="sip.drachtio.org", nonce="S24Jo99ojOfbPE2SaDRCOpaABx3Fr1Q6", qop="auth"'
        }
      }) ;
    }
    else {
     res.send(200, { body: config.sdp}) ;
    }
  }) ;

  app.bye( function(req,res){
    res.send(200, function(err) {
        //all done
        assert( app.idle ); 
        app.disconnect() ;                
    }) ;
  }) ;

  app.set('api logger',fs.createWriteStream(config.apiLog) ) ;
  app.connect(config.connect_opts) ;

  return app ;
} ;




