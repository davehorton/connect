var drachtio = require('../..') ;
var fs = require('fs') ;
var assert = require('assert');
var should = require('should');
var merge = require('merge') ;
var debug = require('debug')('drachtio-client') ;
var fixture = require('drachtio-test-fixtures') ;
var proxy, uas ;
var cfg = fixture(__dirname,[8040,8041,8042],[6040,6041,6042]) ;

function configureUac( app, config ) {
    app.set('api logger',config.apiLog) ;
    app.connect(config.connect_opts) ;
    return app ;
}

describe.only('cdr', function() {
    this.timeout(6000) ;

    before(function(done){
        cfg.startServers(done) ;
    }) ;
    after(function(done){
        cfg.stopServers(done) ;
    }) ;
 
    it('should write 1 attempt and 1 stop records when no clients connected', function(done) {
        var self = this ;
        var app = drachtio() ;
        configureUac( app, cfg.client[0] ) ;
        proxy = require('../scripts/cdr/app')(merge({proxyTarget: cfg.sipServer[2], cdrOnly: true}, cfg.client[1])) ;
        cfg.connectAll([app, proxy], function(err){
            if( err ) throw err ;
            debug('connected')
            app.request({
                uri: cfg.sipServer[1],
                method: 'INVITE',
                body: cfg.client[0].sdp,
                headers: {
                    subject: self.test.fullTitle()
                }
            }, function( err, req ) {
                should.not.exist(err) ;
                req.on('response', function(res, ack){
                    res.should.have.property('status',503); 
                    ack() ;
                    setTimeout(function(){
                        should.exist( proxy.getAttemptCdr() ) ;
                        should.exist( proxy.getStopCdr() ) ;
                        proxy.getAttemptCdr().should.have.length(1) ;
                        proxy.getStopCdr().should.have.length(1) ;
                        done() ;                        
                    }, 100) ;
                }) ;
            }) ;            
        }) ;
    }) ;    
}) ;
