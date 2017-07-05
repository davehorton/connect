const should = require('should');
const Agent = require('../..').Agent ;
const fixture = require('drachtio-test-fixtures') ;
let uac, uas ;
const cfg = fixture(__dirname, [9022, 9023, 9024], [6060, 6061, 6062]) ;

describe('middleware', function() {
  this.timeout(6000) ;

  before(function(done) {
    cfg.startServers(done) ;
  }) ;
  after(function(done) {
    cfg.stopServers(done) ;
  }) ;

  it('must enable locals', function(done) {
    uac = cfg.configureUac(cfg.client[0], Agent) ;
    uas = require('../scripts/invite-non-success/app')(cfg.client[1]) ;
    cfg.connectAll([uac, uas], (err) => {
      uac.request({
        uri: cfg.sipServer[1],
        method: 'INVITE',
        body: cfg.client[0].sdp
      }, (err, req) => {
        should.not.exist(err) ;
        req.on('response', (res) => {
          res.should.have.property('status', 486);
          uac.idle.should.be.true ;
          uas.idle.should.be.true ;
          done() ;
        }) ;
      }) ;
    }) ;
  }) ;

  it('must set response time in a custom header', function(done) {
    uac = cfg.configureUac(cfg.client[0], Agent) ;
    uas = require('../scripts/invite-non-success/app2')(cfg.client[1]) ;
    cfg.connectAll([uac, uas], (err) => {
      uac.request({
        uri: cfg.sipServer[1],
        method: 'INVITE',
        body: cfg.client[0].sdp
      }, (err, req) => {
        should.not.exist(err) ;
        req.on('response', (res) => {
          res.should.have.property('status', 486);
          uac.idle.should.be.true ;
          uas.idle.should.be.true ;
          done() ;
        }) ;
      }) ;
    }) ;
  }) ;
}) ;
