const drachtio = require('../..') ;
const should = require('should');
const merge = require('merge') ;
const fixture = require('drachtio-test-fixtures') ;
const cfg = fixture(__dirname, [8060, 8061, 8062], [6060, 6061, 6062]) ;

let uas ;

function configureUac(app, config) {
    app.set('api logger', config.apiLog) ;
    app.connect(config.connect_opts) ;
    return app ;
}

describe('uac / uas', function() {
  this.timeout(6000) ;

  before(function(done){
    cfg.startServers(done) ;
  }) ;
  after(function(done){
    cfg.stopServers(done) ;
  }) ;
 
  it('should be able to set a custom header', function(done) {
    var app = drachtio() ;
    configureUac(app, cfg.client[0]) ;
    uas = require('../scripts/custom-headers/app')(cfg.client[1]) ;
    cfg.connectAll([app, uas], (err) => {
      if (err) throw err ;
      app.request({
        uri: cfg.sipServer[1],
        method: 'OPTIONS',
        headers: {
          Subject: this.test.fullTitle()
        }
      }, (err, req) => {
        should.not.exist(err) ;
        req.on('response', (res) => {
          res.should.have.property('status', 200);
          res.get('X-Custom').should.eql('drachtio rocks!') ;
          app.idle.should.be.true ;
          done() ;
        }) ;
      }) ;
    }) ;
  }) ;
  it('should be able to set a well-known header', function(done) {
    const app = drachtio() ;
    configureUac(app, cfg.client[0]) ;
    uas = require('../scripts/custom-headers/app')(cfg.client[1]) ;
    cfg.connectAll([app, uas], (err) => {
      if (err) throw err ;
      app.request({
        uri: cfg.sipServer[1],
        method: 'MESSAGE',
        headers: {
          Subject: this.test.fullTitle()
        }
      }, (err, req) => {
        should.not.exist(err) ;
        req.on('response', (res) => {
          res.should.have.property('status', 200);
          res.get('Subject').should.eql('pure awesomeness') ;
          app.idle.should.be.true ;
          done() ;
        }) ;
      }) ;
    }) ;
  }) ;
  it('should be able to reject an INVITE', function(done) {
    const app = drachtio() ;
    configureUac(app, cfg.client[0]) ;
    uas = require('../scripts/invite-non-success/app')(merge({status:486}, cfg.client[1])) ;
    cfg.connectAll([app, uas], (err) => {
      if (err) throw err ;
      app.request({
        uri: cfg.sipServer[1],
        method: 'INVITE',
        body: cfg.client[0].sdp,
        headers: {
          Subject: this.test.fullTitle()
        }
      }, (err, req) => {
        should.not.exist(err) ;
        req.on('response', (res, ack) => {
          res.should.have.property('status', 486);
          app.idle.should.be.true ;
          done() ;
        }) ;
      }) ;
    }) ;
  }) ;
  it('should be able to cancel an INVITE', function(done) {
    const app = drachtio() ;
    configureUac(app, cfg.client[0]) ;
    uas = require('../scripts/invite-cancel/app')(cfg.client[1]) ;
    cfg.connectAll([app, uas], (err) => {
      if (err) throw err ;
      app.request({
        uri: cfg.sipServer[1],
        method: 'INVITE',
        body: cfg.client[0].sdp,
        headers: {
          Subject: this.test.fullTitle()
        }
      }, (err, req) => {
        should.not.exist(err) ;
        req.on('response', (res, ack) => {
          if (res.status === 180) {
            req.cancel((err, cancel) => {
              should.not.exist(err) ;
            }) ;
          }
          else {
            res.should.have.property('status', 487);
            app.idle.should.be.true ;
            done() ;
          }
        }) ;
      }) ;
    }) ;
  }) ;
  it('should connect a call and allow tear down from UAS side', function(done) {
    const app = drachtio() ;
    configureUac(app, cfg.client[0]) ;
    uas = require('../scripts/invite-success-uas-bye/app')(cfg.client[1]) ;

    app.bye((req, res) => {
      res.send(200, (err, bye) => {
        should.not.exist(err) ;
        app.idle.should.be.true;
        done() ;
      }) ;
    }) ;
    cfg.connectAll([app, uas], (err) => {
      if (err) throw err ;

      app.request({
        uri: cfg.sipServer[1],
        method: 'INVITE',
        body: cfg.client[0].sdp,
        headers: {
          Subject: this.test.fullTitle()
        }
      }, (err, req) => {
        should.not.exist(err) ;
        req.on('response', (res, ack) => {
          //
          //validate response and send ack
          //
          res.should.have.property('status', 200);
          ack();
        }) ;
      }) ;
    }) ;
  }) ;
  it('should connect a call and allow tear down from UAC side', function(done) {
    const app = drachtio() ;
    configureUac(app, cfg.client[0]) ;
    uas = require('../scripts/invite-success-uac-bye/app')(cfg.client[1]) ;
    cfg.connectAll([app, uas], (err) => {
      if (err) throw err ;

      app.request({
        uri: cfg.sipServer[1],
        method: 'INVITE',
        body: cfg.client[0].sdp,
        headers: {
          Subject: this.test.fullTitle()
        }
      }, (err, req) => {
        should.not.exist(err) ;
        req.on('response', (res, ack) => {
          res.should.have.property('status', 200);
          ack() ;

          setTimeout(() => {
            app.request({
              method: 'BYE',
              stackDialogId: res.stackDialogId
            }, (err, bye) => {
              should.not.exist(err) ;
              bye.on('response', (response) => {
                response.should.have.property('status', 200);
                app.idle.should.be.true ;
                done() ;
              }) ;
            }) ;
          }, 1) ;
        }) ;
      }) ;
    }) ;
  }) ;
  it('should be able to connect a call with a reliable provisional response', function(done) {
    const app = drachtio() ;
    configureUac(app, cfg.client[0]) ;
    uas = require('../scripts/invite-100rel/app')(cfg.client[1]) ;
    cfg.connectAll([app, uas], (err) => {
      if (err) throw err ;

      app.request({
        uri: cfg.sipServer[1],
        method: 'INVITE',
        headers: {
          'Require': '100rel',
          'Subject': this.test.fullTitle()
        },
        body: cfg.client[0].sdp
      }, (err, req) => {
        should.not.exist(err) ;
        req.on('response', (res, ack) => {
          if (res.status > 100 && res.status < 200) {
            res.get('Require').should.eql('100rel') ;
            ack() ;
          }
          if (res.status >= 200) {
            ack() ;
            //
            //after a short time, send a BYE and validate the response
            //
            setTimeout(() => {
              app.request({
                method: 'BYE',
                stackDialogId: res.stackDialogId
              }, (err, bye) => {
                should.not.exist(err) ;
                bye.on('response', (response) => {
                  response.should.have.property('status', 200);
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
  it('should be able to set a Contact header', function(done) {
    const app = drachtio() ;
    configureUac(app, cfg.client[0]) ;
    uas = require('../scripts/invite-uas-set-contact/app')(cfg.client[1]) ;

    app.bye((req, res) => {
      res.send(200, (err, bye) => {
        should.not.exist(err) ;
        app.idle.should.be.true;
        done() ;
      }) ;
    }) ;
    cfg.connectAll([app, uas], (err) => {
      if (err) throw err ;

      app.request({
        uri: cfg.sipServer[1],
        method: 'INVITE',
        body: cfg.client[0].sdp,
        headers: {
          Subject: this.test.fullTitle()
        }
      }, (err, req) => {
        should.not.exist(err) ;
        req.on('response', (res, ack) => {
          //
          //validate response and send ack
          //
          res.should.have.property('status', 200);
          var contact = res.get('Contact').split(',');

          // should only be one contact header
          contact.should.have.length(1);
          ack() ;
        }) ;
      }) ;
    }) ;
  }) ;
}) ;
