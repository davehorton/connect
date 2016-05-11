var drachtio = require('../../..') ;
var fs = require('fs') ;
var passport       = require('passport') ;
var DigestStrategy = require('passport-http').DigestStrategy; 

var users = [
    { id: 1, username: 'dhorton', password: '1234', domain: 'sip.drachtio.org'}
];
function findByUsername( username, fn )
{
    for (var i = 0, len = users.length; i < len; i++)
    {
        var user = users[i];
        if (user.username === username) { return fn( null, user ); }
    }
    return fn(null, null);
}

passport.use
(
  new DigestStrategy(
    { qop: 'auth', realm: 'sip.drachtio.org' },
    function( username, done )
    {
        // Find the user by username. If there is no user with the given username
        // set the user to `false` to indicate failure. Otherwise, return the
        // user and user's password.
        
        findByUsername(
            username, 
            function( err, user )
            {
                if ( err )   { return done( err ); }
                if ( !user ) { return done( null, false ); }

                return done( null, user, user.password );
            }
        );
    },
    function(params, done) {
      // validate nonces as necessary
      done(null, true) ;
    }
));

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

  app.use(passport.initialize());
  app.use('register', passport.authenticate('digest', { session: false })) ;

  app.register( function(req, res) {
    res.send(200, {
      headers: {
        expires: 3600
      }
    }) ;
  }) ;

  app.connect(config.connect_opts) ;

  return app ;
} ;




