const drachtio = require('../..') ;
const should = require('should');
const merge = require('merge') ;
const debug = require('debug')('drachtio-client') ;
const fixture = require('drachtio-test-fixtures') ;
let proxy;
const cfg = fixture(__dirname, [8040, 8041, 8042], [6040, 6041, 6042]) ;

function configureUac(app, config) {
  app.set('api logger', config.apiLog) ;
  app.connect(config.connect_opts) ;
  return app ;
}

describe('cdr', function() {
  this.timeout(6000) ;

  before((done) => {
    cfg.startServers(done) ;
  }) ;
  after((done) => {
    cfg.stopServers(done) ;
  }) ;

  it('should write 1 attempt and 1 stop records when no clients connected', function(done) {
    const app = drachtio() ;
    configureUac(app, cfg.client[0]) ;
    proxy = require('../scripts/cdr/app')(merge({proxyTarget: cfg.sipServer[2], cdrOnly: true}, cfg.client[1])) ;
    cfg.connectAll([app, proxy], (err) => {
      if (err) throw err ;
      debug('connected') ;
      app.request({
        uri: cfg.sipServer[1],
        method: 'INVITE',
        body: cfg.client[0].sdp,
        headers: {
          subject: this.test.fullTitle()
        }
      }, (err, req) => {
        should.not.exist(err) ;
        req.on('response', (res, ack) => {
          res.should.have.property('status', 503);
          ack() ;
          setTimeout(() => {
            should.exist(proxy.getAttemptCdr()) ;
            should.exist(proxy.getStopCdr()) ;
            proxy.getAttemptCdr().should.have.length(1) ;
            proxy.getStopCdr().should.have.length(1) ;
            done() ;
          }, 100) ;
        });
      });
    }) ;
  }) ;
}) ;
