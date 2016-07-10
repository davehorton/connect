var connect = require('../');
var app = connect() ;
var fs = require('fs') ;
var argv = require('minimist')(process.argv.slice(2));
var debug = require('debug')('basic') ;

app.connect({
  host: '127.0.0.1',
  port: 9022,
  secret: 'cymru',
  methods: ['invite','bye'],
  set: {
    'api logger': fs.createWriteStream(argv.apiTrace) 
  }
}) ;

app.on('connect', function( err, hostport ){
  console.log('successfully connected to server listening on ' + hostport) ;

  app.uac({
      uri: '',
      method: 'OPTIONS',
      headers: {
        'User-Agent': 'drachtio 0.1',
      }, 
    },
    function( err, req ){
      if( err ) { throw err; } 
      debug('sent request: %s', JSON.stringify(req) ) ;

      req.on('response', function(res){
        debug('received response with status: %s', res.status) ;
      }) ;
    }
  ) ;
}) ;

