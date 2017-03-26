var drachtio = require('../../..');
var fs = require('fs') ;
var assert = require('assert') ;
var debug = require('debug')('invite-100-rel') ;

module.exports = function( config ) {

  var app = drachtio() ;

  var inviteRes ;

  app.invite(function(req,res) {
      var require = req.get('Require').toString() ;
      assert(-1 !== require.indexOf('100rel'), 'expecting 100rel to be required') ;
      inviteRes = res ;

      debug('sending a 183 with 100rel');
      res.send(183, { 
        body: config.sdp,
        headers: {
          'Require': '100rel'
        }
      }, function(err, msg) {
        debug('res#send callback err: %s', JSON.stringify(arguments)) ;
      }, function() {
        debug('received PRACK');
      }) ;
  });

  app.prack(function(req,res){
    res.send(200); 
    inviteRes.send(200, { body: config.sdp}) ;
  }) ;

  app.bye( function(req,res){
      res.send(200, function(err){
        //all done
        debug('exiting..'); 
        assert(!err); 
        assert( app.idle ); 
        app.disconnect() ;                
      }) ;
  }) ;

  app.set('api logger',fs.createWriteStream(config.apiLog) ) ;
  app.connect(config.connect_opts) ;

  return app ;
} ;

