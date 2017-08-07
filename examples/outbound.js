const drachtio = require('..') ;
const app = drachtio() ;

app.listen({
  port: 9021,
  secret: 'cymru'
}, (obj) => {
  console.log('listening on port 9021...');
}) ;

app.on('connect', (err, hostport) => {
  if (err) {
    console.log(`connect error: ${err}`);
  }
  console.log(`incoming connection from server with hostport ${hostport}`);
}) ;

app.invite((req, res) => {
  res.send(480, 'Try again soon!');
  app.endSession(res);
});


