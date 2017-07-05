const drachtio = require('../..') ;
const should = require('should');
const debug = require('debug')('drachtio-client') ;
const fixture = require('drachtio-test-fixtures') ;
const cfg = fixture(__dirname, [8060, 8061, 8062], [6060, 6061, 6062]) ;

let uas ;

function configureUac(app, config) {
  app.set('api logger', config.apiLog) ;
  app.connect(config.connect_opts) ;
  return app ;
}

describe('passport integration', function() {
  this.timeout(6000) ;

  before((done) => {
    cfg.startServers(done) ;
  }) ;
  after((done) => {
    cfg.stopServers(done) ;
  }) ;

  it('should work with passport digest authentication with credentials provided directly', function (done) {
    var app = drachtio() ;
    configureUac(app, cfg.client[0]) ;
    uas = require('../scripts/passport/app')(cfg.client[1]) ;
    cfg.connectAll([app, uas], (err) => {
      if (err) {
        throw err ;
      }
      app.request({
        uri: cfg.sipServer[1],
        method: 'REGISTER',
        headers: {
          To: 'sip:dhorton@sip.drachtio.org',
          From: 'sip:dhorton@sip.drachtio.org',
          Contact: '<sip:dhorton@sip.drachtio.org>;expires=30',
          Subject: this.test.fullTitle()
        },
        auth: {
          username: 'dhorton',
          password: '1234'
        }
      }, (err, req) => {
        should.not.exist(err) ;
        req.on('response', (res) => {
          res.should.have.property('status', 200);

          //TODO: generate an Authorization header and retry
          app.idle.should.be.true ;
          done() ;
        }) ;
      }) ;
    }) ;
  }) ;
  it('should work with INVITE as well as REGISTER', function(done) {
    const app = drachtio() ;
    configureUac(app, cfg.client[0]) ;
    uas = require('../scripts/passport/app')(cfg.client[1]) ;
    cfg.connectAll([app, uas], (err) => {
      if (err) throw err ;
      app.request({
        uri: cfg.sipServer[1],
        method: 'INVITE',
        headers: {
          To: 'sip:dhorton@sip.drachtio.org',
          From: 'sip:dhorton@sip.drachtio.org',
          Contact: '<sip:dhorton@sip.drachtio.org>;expires=30',
          Subject: this.test.fullTitle()
        },
        auth: {
          username: 'dhorton',
          password: '1234'
        }
      }, (err, req) => {
        should.not.exist(err) ;
        req.on('response', (res) => {
          res.should.have.property('status', 200);

          //TODO: generate an Authorization header and retry
          app.idle.should.be.true ;
          done() ;
        }) ;
      }) ;
    }) ;
  }) ;
  it('should work with 407 as well as 401', function(done) {
    var app = drachtio() ;
    configureUac(app, cfg.client[0]) ;
    uas = require('../scripts/passport/no-passport-407-challenge')(cfg.client[1]) ;
    cfg.connectAll([app, uas], (err) => {
      if (err) throw err ;
      app.request({
        uri: cfg.sipServer[1],
        method: 'INVITE',
        headers: {
          To: 'sip:dhorton@sip.drachtio.org',
          From: 'sip:dhorton@sip.drachtio.org',
          Contact: '<sip:dhorton@sip.drachtio.org>;expires=30',
          Subject: this.test.fullTitle()
        },
        auth: {
          username: 'dhorton',
          password: '1234'
        }
      }, (err, req) => {
        should.not.exist(err) ;
        req.on('response', (res) => {
          res.should.have.property('status', 200);

          //TODO: generate an Authorization header and retry
          app.idle.should.be.true ;
          done() ;
        }) ;
      }) ;
    }) ;
  }) ;
  it('should work with passport digest authentication with credentials provided via callback', function(done) {
    const app = drachtio() ;
    configureUac(app, cfg.client[0]) ;
    uas = require('../scripts/passport/app')(cfg.client[1]) ;
    let seq1;
    cfg.connectAll([app, uas], (err) => {
      if (err) throw err ;
      app.request({
        uri: cfg.sipServer[1],
        method: 'REGISTER',
        headers: {
          To: 'sip:dhorton@sip.drachtio.org',
          Contact: '<sip:dhorton@sip.drachtio.org>;expires=30',
          From: 'sip:dhorton@sip.drachtio.org',
          Subject: this.test.fullTitle()
        },
        auth: (req, res, callback) => {
          seq1 = req.getParsedHeader('cseq').seq ;
          debug('cseq value on first request: ', seq1) ;
          res.should.have.property('status', 401) ;
          callback(null, 'dhorton', '1234') ;
        }
      }, (err, req) => {
        should.not.exist(err) ;
        req.on('authenticate', (req) => {
        }) ;
        req.on('response', (res) => {
          res.should.have.property('status', 200);

          //TODO: generate an Authorization header and retry
          app.idle.should.be.true ;
          done() ;
        }) ;
      }) ;
    }) ;
  }) ;
  it('should allow passport.authenticate function as app.register middleware', function(done) {
    const app = drachtio() ;
    configureUac(app, cfg.client[0]) ;
    uas = require('../scripts/passport/app2')(cfg.client[1]) ;
    cfg.connectAll([app, uas], (err) => {
      if (err) throw err ;
      app.request({
        uri: cfg.sipServer[1],
        method: 'REGISTER',
        headers: {
          To: 'sip:dhorton@sip.drachtio.org',
          Contact: '<sip:dhorton@sip.drachtio.org>;expires=30',
          From: 'sip:dhorton@sip.drachtio.org',
          Subject: this.test.fullTitle()
        },
        auth: {
          username: 'dhorton',
          password: '1234'
        }
      }, (err, req) => {
        should.not.exist(err) ;
        req.on('response', (res) => {
          res.should.have.property('status', 200);

          //TODO: generate an Authorization header and retry
          app.idle.should.be.true ;
          done() ;
        }) ;
      }) ;
    }) ;
  });
}) ;
