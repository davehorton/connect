var drachtio = require('../..') ;
var fs = require('fs') ;
var assert = require('assert');
var should = require('should');
var merge = require('merge') ;
var debug = require('debug')('drachtio-client') ;
var fixture = require('drachtio-test-fixtures') ;
var cfg = fixture(__dirname,[8060,8061,8062],[6060,6061,6062]) ;

var proxy, uas ;

function configureUac( app, config ) {
    app.set('api logger',fs.createWriteStream(config.apiLog) ) ;
    app.connect(config.connect_opts) ;
    return app ;
}

describe('proxy', function() {
    this.timeout(6000) ;

    before(function(done){
        cfg.startServers(done) ;
    }) ;
    after(function(done){
        cfg.stopServers(done) ;
    }) ;
 
    it('should respond 483 Too Many Hops when Max-Forwards is 0', function(done) {
        var self = this ;
        var app = drachtio() ;
        configureUac( app, cfg.client[0] ) ;
        proxy = require('../scripts/proxy/app')(merge({proxyTarget: cfg.sipServer[2], remainInDialog: true, label: this.test.fullTitle()}, cfg.client[1])); 
        cfg.connectAll( [app, proxy], function(err){
            if( err ) throw err ;            
            app.request({
                uri: cfg.sipServer[1],
                method: 'INVITE',
                headers: {
                    'Max-Forwards': 0,
                    'Subject': self.test.fullTitle()
                },
                body: cfg.client[0].sdp
            }, function( err, req ) {
                should.not.exist(err) ;
                req.on('response', function(res){
                    res.should.have.property('status',483); 
                    app.idle.should.be.true ;
                    done() ;                        
                }) ;
            }) ;
        }) ;
    }) ;

    it('should decrement Max-Forwards when provided', function(done) {
        var self = this ;
        var app = drachtio() ;
        configureUac( app, cfg.client[0] ) ;
        proxy = require('../scripts/proxy/app')(merge({proxyTarget: cfg.sipServer[2], remainInDialog: false}, cfg.client[1])); 
        uas = require('../scripts/invite-success-uas-bye/app')(cfg.client[2]) ;

        app.bye( function(req,res){
            res.send(200, function(err, bye){
                should.not.exist(err) ;
                app.idle.should.be.true; 
                done() ;
            }) ;
        }) ;

        cfg.connectAll([app, proxy, uas], function(err){
            if( err )  throw err ;

            debug('sending INVITE');
            app.request({
                uri: cfg.sipServer[1],
                method: 'INVITE',
                headers: {
                    'Max-Forwards': 11,
                    'Subject': self.test.fullTitle()
                },
                body: cfg.client[0].sdp
            }, function( err, req ) {
                should.not.exist(err) ;
                req.on('response', function(res, ack){
                    res.should.have.property('status',200); 
                    res.get('Max-Forwards').should.eql('10') ;
                    ack() ;
                    debug('sent ACK'); 
                }) ;
            }) ;            
        }) ;
    }) ;   
    it('should add Record-Route header when remainInDialog is set to true', function(done) {
        var self = this ;
        var app = drachtio() ;
        configureUac( app, cfg.client[0] ) ;
        proxy = require('../scripts/proxy/app')(merge({proxyTarget: cfg.sipServer[2], remainInDialog: true}, cfg.client[1])); 
        uas = require('../scripts/invite-success-uas-bye/app')(cfg.client[2]) ;

        app.bye( function(req,res){
            res.send(200, function(err, bye){
                should.not.exist(err) ;
                app.idle.should.be.true; 
                done() ;
            }) ;
        }) ;

        cfg.connectAll([app, proxy, uas], function(err){
            if( err )  throw err ;

            app.request({
                uri: cfg.sipServer[1],
                method: 'INVITE',
                headers: {
                    'Subject' : self.test.fullTitle()
                },
                body: cfg.client[0].sdp
            }, function( err, req ) {
                should.not.exist(err) ;
                req.on('response', function(res, ack){
                    res.should.have.property('status',200); 
                    should.exist( res.get('Record-Route') ) ;
                    ack() ;
                }) ;
            }) ;            
        }) ;
    }) ;

    it('should not add Record-Route header when remainInDialog set to false', function(done) {
        var self = this ;
        var app = drachtio() ;
        configureUac( app, cfg.client[0] ) ;
        proxy = require('../scripts/proxy/app')(merge({proxyTarget: cfg.sipServer[2], remainInDialog: false}, cfg.client[1])); 
        uas = require('../scripts/invite-success-uas-bye/app')(cfg.client[2]) ;

        app.bye( function(req,res){
            res.send(200, function(err, bye){
                should.not.exist(err) ;
                app.idle.should.be.true; 
                done() ;
            }) ;
        }) ;

        cfg.connectAll([app, proxy, uas], function(err){
            if( err )  throw err ;

            app.request({
                uri: cfg.sipServer[1],
                method: 'INVITE',
                headers: {
                    'Subject' : self.test.fullTitle()
                },
                body: cfg.client[0].sdp
            }, function( err, req ) {
                should.not.exist(err) ;
                req.on('response', function(res, ack){
                    res.should.have.property('status',200); 
                    should.not.exist( res.get('Record-Route') ) ;
                    ack() ;
                }) ;
            }) ;            
        }) ;
    }) ; 
    
    it('should not add Record-Route header by default', function(done) {
        var self = this ;
        var app = drachtio() ;
        configureUac( app, cfg.client[0] ) ;
        proxy = require('../scripts/proxy/app')(merge({proxyTarget: cfg.sipServer[2]}, cfg.client[1])); 
        uas = require('../scripts/invite-success-uas-bye/app')(cfg.client[2]) ;

        app.bye( function(req,res){
            res.send(200, function(err, bye){
                should.not.exist(err) ;
                app.idle.should.be.true; 
                done() ;
            }) ;
        }) ;

        cfg.connectAll([app, proxy, uas], function(err){
            if( err )  throw err ;
            app.request({
                uri: cfg.sipServer[1],
                method: 'INVITE',
                headers: {
                    'Subject': self.test.fullTitle()
                },
                body: cfg.client[0].sdp
            }, function( err, req ) {
                should.not.exist(err) ;
                req.on('response', function(res, ack){
                    res.should.have.property('status',200); 
                    should.not.exist( res.get('Record-Route') ) ;
                    ack() ;
                }) ;
            }) ;            
        }) ;
    }) ;    
    it.only('should handle handle reliable provisional responses', function(done) {
        var self = this ;
        var app = drachtio() ;
        configureUac( app, cfg.client[0] ) ;
        proxy = require('../scripts/proxy/app')(merge({proxyTarget: cfg.sipServer[2], remainInDialog: true}, cfg.client[1])); 
        uas = require('../scripts/invite-100rel/app')(cfg.client[2]) ;

        cfg.connectAll([app, proxy, uas], function(err){
            if( err ) throw err ;
            app.request({
                uri: cfg.sipServer[1],
                method: 'INVITE',
                headers: {
                    'Require': '100rel',
                    'Subject': self.test.fullTitle()
                },
                body: cfg.client[0].sdp
            }, function( err, req ) {
                should.not.exist(err) ;
                req.on('response', function(res, ack){
                    if( res.status > 100 && res.status < 200 ) {
                        var require = res.get('Require') ;
                        require.should.eql('100rel') ;
                        ack() ;
                    }
                    if( res.status >= 200 ) {
                        res.should.have.property('status',200); 
                        ack() ; 
                       //
                        //after a short time, send a BYE and validate the response
                        //
                        setTimeout( function(){
                            app.request({
                                method: 'BYE',
                                stackDialogId: res.stackDialogId
                            }, function(err, bye){
                                should.not.exist(err) ;
                                bye.on('response', function(response){
                                    response.should.have.property('status',200);
                                    app.idle.should.be.true ;
                                    done() ;
                                }) ;
                            }) ;
                        }, 1) ;
                    }
                }) ;
            }) ;            
        }) ;
    }) ;  
}) ;
