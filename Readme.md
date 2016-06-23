# drachtio [![Build Status](https://travis-ci.org/davehorton/drachtio.svg?branch=master)](http://travis-ci.org/davehorton/drachtio) [![NPM version](https://badge.fury.io/js/drachtio.svg)](http://badge.fury.io/js/drachtio)

<!--
[![Join the chat at https://gitter.im/davehorton/drachtio](https://badges.gitter.im/davehorton/drachtio.svg)](https://gitter.im/davehorton/drachtio?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)
-->

[![drachtio logo](http://www.dracht.io/images/definition_only-cropped.png)](http://davehorton.github.io/drachtio/)

drachtio is a Node.js-based middleware framework for building [SIP](https://www.ietf.org/rfc/rfc3261.txt) applications.  It is inspired by classic http middleware frameworks such as [connect](https://github.com/senchalabs/connect) and [expressjs](http://expressjs.com/), and developers who are familiar with such frameworks will find it quite easy to use.  

For those developers new to SIP and VoIP in general, drachtio provides an easy path to building full-functional SIP applications; while experienced SIP application developers will appreciate the flexibility that drachtio provides in terms of enabling any kind of SIP element: proxy servers, registars, user agent clients and servers, and back-to-back user agents.

drachtio works in concert with [drachtio-server](https://github.com/davehorton/drachtio-server) -- drachtio-server implements the SIP stack and handles low-level SIP message processing, while drachtio-based applications provide the higher level application logic and control the actions of a drachtio server over a TCP network connection.

drachtio also enables the higher level frameworks 
+ [drachtio-srf](https://github.com/davehorton/drachtio-srf) - the drachtio sigaling resource framework, and 
+ [drachtio-fsmrf](https://github.com/davehorton/drachtio-fsmrf) - the drachtio media resource framework.  

> Tip: Use drachtio for simple SIP applications (proxy servers, registrars, simple clients); use drachtio-srf for more complex applications that require SIP Dialog support. Incorporate drachtio-fsmrf with drachtio-srf when these more complex applications require media processing features (e.g. IVR, conferencing, recording, etc).

```js
//sample application: a SIP proxy
var drachtio = require('drachtio');
var app = drachtio() ;

//connect to a drachtio server
app.connect({host:'localhost', port: 8022, secret: 'cymru'}) ;

app.invite( function( req, res ) {
  var user = req.msg.uri.match(/sip:(.*?)@(.*?)$/) ;

  //search for the user in 3 different locations
  req.proxy({
    destination: [
      'sip:' + user[1] + '@site1.mycompany.com',
      'sip:' + user[1] + '@site2.mycompany.com',
      'sip:' + user[1] + '@site2.mycompany.com'
    ],
    remainInDialog: true,
    forking: 'simultaneous',
    headers: {
      'Subject': 'Incoming call for ' + user[1] 
    }
  }, function(err, response){
    if( err ) return console.error('Error attempting to proxy request: ', err) ;
    console.log('Final response for proxy: ' + response.finalStatus ) ;
  }) ;
}) ;
```

## Getting started
### Creating an application
The first thing an application must do is to require the drachtio library and invoke the returned function to create an application.  The application instance that is created is an EventEmitter.
```js
var drachtio = require('drachtio') ;
var app = drachtio() ;
```
### Connecting to the server
The next thing an application must do is to call the 'connect' method in order to connect to the drachtio-server that will be providing the SIP endpoint. By default, 
drachtio-server listens for TCP connections from clients on port 8022.  Clients must also provide a shared secret as a means of authentication.  
```js
app.connect({
    host:'localhost',      //ip address or DNS name of drachtio-server
    port: 8022,           //defaults to 8022 if not provided
    secret: 'cymru'    //shared secret
 }, function( err, hostport ) {
    if( err ) throw err ;
    console.log('success! drachtio-server is listening on ' + hostport) ;
}) ;
```

A 'connect' event is emitted by the app object when the connection has been established; alternatively, a callback can be passed to the connect method, as shown above.  

The callback or event handler will an error object (null in the case of a successful connection) and a string variable describing the sip address and port the drachtio server is listening on for SIP messages.

### Responding to sip requests
A drachtio application can both send and receive SIP requests.  To receive SIP requests (i.e to act as a User Agent Server, or UAS), app[verb] methods are used.  Request and Response objects are provided to the callback. 

The Request object contains information describing the incoming sip request, along with methods that can be used to act on the request (e.g., req#proxy is a method provided to proxy the request).  The Response object contains methods that allow the application to control the generation of the sip response. 

```js
app.register( function( req, res ) {
   var contact = req.getParsedHeader('Contact') ;
   var expires = contact.params.expires || req.get('Expires') ;
   console.log('Received a REGISTER request with Expires value: ' + expires) ;

   res.send( 200, {
      headers: {
         'Expires': expires
      }
   })
}) ;
```
> Notes:

> + drachtio-server automatically sends a 100 Trying to all incoming INVITE messages, so a drachtio app does not need to do so.

> + A 'Content-Length' header is automatically provided by drachtio-server, so the application should not include that header.

> + A 'Content-Type' header of 'application/sdp' will automatically be added by drachtio-server, where appropriate.  When sending any other content types, an application must explicitly include a 'Content-Type' header.

> + Request and Response objects both support a `get` method to return the value of a named SIP header as a string value, and `getParsedHeader` to return object that represents the SIP header parsed into its component values.


#### res#send
The `res.send` method can take up to four arguments: `(code, reason, opts, callback)`:
- `code` is the only required parameter and is the numeric SIP response value.
- `reason` is a custom status text value that will appear in the SIP response line; if not provided the well-known reason that is associated with the provided code will be used.
- `opts` is a javascript object containing values that control the generation of the response; most notably a `body` property which provides a value for the body of the SIP response and a `headers` property which provides one or more SIP headers that will be populated in the response.
- `callback` is a function that will be called once the SIP response message has actually been sent.  The callback will receive two arguments: `(err, response)`; the `err` value is an object describing an error (if any) that drachtio-server encountered in generating the SIP response, and the response object is a representation of the actual message that was sent over the wire. 

> Note:
> Most of the standard SIP headers in the response will be populated automatically by the drachtio server based on the associated request.  It is only necessary to populate those additional headers that you want to be carried in the response which the drachtio server would not know to populate.

```js
app.invite( function( req, res ) {
    res.send(480, 'Database down', {
        headers: {
            'Retry-After': "1800 (scheduled maintenance)"
        }
    }) ;
}) ;
```
### Sending sip requests

SIP requests can be sent (i.e., to act as a User Agent Client, or UAC) using the app.request method:

```js
// connect and then send an OPTIONS ping
app.connect({host:'localhost',port: 8022,secret: 'cymru'},
    function(err, hostport){
        if( err ) throw err ;

        //connected ok
        app.request({
            uri: 'sip:1234@10.168.12.139'.
            method: 'OPTION',
            headers: {
                'User-Agent': 'dracht.io'
            }
        } function( err, req ) {
            if( err ) console.error( err ) ;

            req.on('response', function(response){
                console.log('response status was ' + response.status) ;
                app.disconnect() ;
            }) ;
        }) ;    
    }
);
```
> Note: as in the above example, an application can only call `app#send` after connecting to drachtio-server.  An attempt to send a request before a connection to the server has been established will result in an error being thrown.

#### app#request
The callback receives the arguments `(err, req)`, where `error` represents the error encountered (if any) attempting to send the request, and the `req` object represents the message that was actually sent over the wire.  

The `req` object provided to the callback is an EventEmitter, and in order to receive responses to the request an application must listen for the `response` event, as shown in the example above.  The `response` event will be emitted with a paramater that describes the response(s) that were received from the network for the request.

#### Generating an ACK request
An ACK is a special case request; it is required to be sent after receiving a final response to an INVITE request.  In the case of sending an INVITE, the `response` event for a final response that is received for that INVITE will be passed a second parameter after the response message itself -- this parameter is a function that can be called to generate the ACK request for the INVITE.

````
app.request({
    uri: myUri,
    method: 'INVITE',
    body: mySdp
}, function( err, req ) {
    if( err ) throw err ;
    req.on('response', function(res, ack){
        if( res.status >= 200 ) ack() ;
    }) ;
}) ;

````

> Note:
> Strictly speaking, it is not necessary to generate the ACK for a non-success final response, because the drachtio server SIP stack does this automatically.  However, there is no harm in calling the `ack()` method in this scenario.  Note that the application *must* call `ack()` in the case of a 200 OK response to an INVITE.

#### Canceling a request

To cancel a sip INVITE that has been sent by the application, an application may use the `cancel` method on the request object that is returned in the callback to `app#request`.

```js
app.request({
    uri: 'sip:1234@192.168.173.139',
    method: 'INVITE',
    body: config.sdp
}, function( err, req ) {
    if( err ) throw err ;
    req.on('response', function(response, ack){
        if( response.status >= 200 ) ack() ;
    }) ;

    //generate cancel after 2 seconds
    setTimeout( function() { 
        req.cancel() ;
    }, 2000) ;
}) ;
```

#### Reliable provisional responses

Responding to a SIP INVITE with a reliable provisional response is easy: just add a `Require: 100rel` header to the INVITE request and drachtio-server will handle that for you.  However, after sending a response reliably, your app should wait for the PRACK to be received before sending the final response.  

```js
var inviteRes ;
app.invite(function(req, res) {
    inviteRes = res ;
    res.send( 183,{
        headers: {
            require: '100rel',
            supported: '100rel'
        },
        body: mySdp
    }) ;
}) ;

app.prack( function(req, res){
    res.send(200) ;
    inviteRes.send( 200, {
        body: mySdp
    }); 
}) ;
```

> Note that if you want to use reliable provisional responses if the remote side supports them, but establish the call without them if the remote side does not support it, then include a `Supported` header but do not include a `Require` header.

Similiarly, if you want to send reliable provisional responses, just add a `Require: 100rel` header in your response, and drachtio-server will handle sending reliable provisional response for you.  

### SIP Proxy
Creating a sip proxy application is easy: simply call `req#proxy` on the incoming request object with an object parameter that provides instructions to drachtio server on how you want the proxy operation carried out.  The `proxy` function takes two parameters `(opts, callback`) as described below:

```js
opts:
    - destination: [String|Array] one more sip uris (required) 
    - remainInDialog: [boolean] if true, insert a Record-Route header 
                    (default: false)
    - followRedirects: [boolean] if true, generate new INVITEs in 
                    response to 3XX responses; 
                    if false, forward 3xx responses upstream
                    back to the originating client (default: false)
    - wantsFullResponse: [boolean] if true, pass full detail
                    on all responses received in callback; 
                    if false, simply invoke callback with no
                    response information once the request(s)
                    have been forwarded (default: false)
    - headers: [Object] SIP headers to add to the forwarded request
    - forking: [String] if 'simultaneous' then requests are forwarded
                    simultaneously to all provided destinations
                    (assuming that multiple destinations were provided);
                    otherwise requests are forwarded serially, 
                    attempting each destination in turn until
                    a final success response is received or the 
                    list of destinations is exhausted (default: serial)


callback( err, response )
    - err: an Error object describing the error, if any, that occurred when 
                    drachtio server attempted to proxy the request
    - response: an object, only provided when the 'wantsFullResponse' 
                    parameter was set to true.  The response object
                    contains full details on all of the final responses
                    received from the forwarded request.
```
An example of the response data provided to the response parameter in the `req#proxy` callback for the case where a single destination was provided and the far end responded with a non-success 404 Not Found response can be found [here](https://gist.github.com/davehorton/040f2b4eceb782e92ea2).
