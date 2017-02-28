var drachtio = require('../../..') ;
var fs = require('fs') ;
var assert = require('assert') ;
var debug = require('debug')('test:invite-success-uas-bye') ;

module.exports = function( config ) {

  var app = drachtio() ;
  app.set('api logger',fs.createWriteStream(config.apiLog) ) ;

  app.on('connect', function(){
    app.client.locals = {
      delay: config.answerDelay || 1,
      reject_ceiling: config.allowCancel || 0,
      dialogId: null, 
      count: 0,
      sdp: config.sdp
    };     
  }) ;

  app.invite(function(req,res){
      if( app.client.locals.count++ < app.client.locals.reject_ceiling ) {
        res.send(180) ;
      }
      else {
        setTimeout( function() {
          res.send(200, { 
            body: app.client.locals.sdp,
            headers: {
              'Max-Forwards': req.get('Max-Forwards'),
              'Contact': 'sip:simon.booth@localhost;gruu;opaque=app:conf:focus:ABCD1234;isfocus'
            }
          }, function(err, msg){
            debug('dialogId recv: ', res.stackDialogId); 
            app.client.locals.dialogId = res.stackDialogId ;

            setTimeout( function() {

              debug('dialogId sent: ', app.client.locals.dialogId); 
              app.request({
                method: 'BYE',
                stackDialogId: app.client.locals.dialogId
              }, function(err, req){
                if( err ) throw err ;
                req.on('response', function(response){
                  //all done
                  assert(200 === response.status) ;
                  debug('exiting..'); 
                  assert( app.idle ); 
                  app.disconnect() ;                
                }); 
              }) ;
            }, 1000) ;

          }) ;                  
        }, app.client.locals.delay) ;
      }
  }) ;

  app.connect(config.connect_opts) ;

  return app ;
} ;




