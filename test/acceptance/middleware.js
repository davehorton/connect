var assert = require('assert');
var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var should = require('should');
var debug = require('debug')('drachtio-client') ;
var Agent = require('../..').Agent ;
var fixture = require('drachtio-test-fixtures') ;
var uac, uas ;
var cfg = fixture(__dirname,[9022,9023,9024],[6060,6061,6062]) ;

describe('middleware', function() {
    this.timeout(6000) ;

    before(function(done){
        cfg.startServers(done) ;
    }) ;
    after(function(done){
        cfg.stopServers(done) ;
    }) ;

    it('must enable locals', function(done) {
        uac = cfg.configureUac( cfg.client[0], Agent ) ;
        uas = require('../scripts/invite-non-success/app')(cfg.client[1]) ;
        cfg.connectAll([uac, uas], function(err){
            uac.request({
                uri: cfg.sipServer[1],
                method: 'INVITE',
                body: cfg.client[0].sdp
            }, function( err, req ) {
                should.not.exist(err) ;
                req.on('response', function(res){
                    res.should.have.property('status',486); 
                    uac.idle.should.be.true ;
                    uas.idle.should.be.true ;
                    done() ;                    
                }) ;
            }) ;
        }) ;
    }) ; 

    it('must set response time in a custom header', function(done) {
        uac = cfg.configureUac( cfg.client[0], Agent ) ;
        uas = require('../scripts/invite-non-success/app2')(cfg.client[1]) ;
        cfg.connectAll([uac, uas], function(err){
            uac.request({
                uri: cfg.sipServer[1],
                method: 'INVITE',
                body: cfg.client[0].sdp
            }, function( err, req ) {
                should.not.exist(err) ;
                req.on('response', function(res){
                    res.should.have.property('status',486); 
                    uac.idle.should.be.true ;
                    uas.idle.should.be.true ;
                    done() ;                    
                }) ;
            }) ;
        }) ;
    }) ; 
}) ;
