# Reddish

Starter kit for realtime database data on the client, using Redis

## Building a realtime stack

When I started my [bootcamp-skeleton project](https://github.com/tomgrek/bootcamp-skeleton),
it was because for many projects I'd been using Meteor, which was a lovely way to develop
quickly with a minimum of configuration, and just focus on the UX and functionality of the product.
But I hated that there was a ton of stuff under the surface that I hadn't made myself. So I
went and made a reusable template project from scratch. (Also this was good because I could
see Meteor headed downhill, and wanted out).

Whilst that project has some great stuff that I've used many times (React configured out of
the box, Node/Express/Passport/Mongo, etc) the one thing I've missed from Meteor, apart from
server-side templating I guess, was realtime database queries that update automatically
on the client side. In Meteor this is called Minimongo, a client-side replication of the back-end
Mongo database, linked together over a protocol called DDP that's implemented over websockets.

Seriously, when you can do something like ```{{for todo of db.find({'todos'})}}``` instead
of setting up all the AJAX (and auth) yourself, it's hyper productive. Plus of course the
client's view updates when the db information changes.

This is a bit of a long post, so I want to add that now, as an employee of a big software
company, I'd probably just use Firebase to do all this, even though I've seen benefit in
figuring it out myself, and like my solution. I used to be on a shoestring budget
for clients, so all this is do-able on a tiny Linode instance. I'm still working through
that mindset. But I have an improved eye for scalability now too, and what I present here
is easily scalable.

## How does Minimongo do this?

I figured it out the hard way. On the server side, Meteor uses 'tailable cursors' and 'oplog tailing'
to send MongoDb updates to the client, which has a bunch of logic that figures out what
the results of the db query should be (and handles offline, etc).

Tailable cursors are when you perform a query, but leave it hanging waiting for future additions.
db.findAll({category: 'articles'}) might initially return 10 articles, (which you
send to the client straight away), but then you can set what should happen when a new one comes in.
And that should be, send a websocket message to the client that there's a new result, and it
should update its collection of articles accordingly.

So far, so good. But then, as I found out, what happens if an article is modified or deleted? Well,
nothing. The cursor doesn't update, in that case. It only sends a notification to NodeJS, and
moves along, in the event of an insert.

In the example of *todos*, it means that you can add new todos from wherever (e.g. command line client,
web app, mobile app) and they show up. But if you mark one as 'done', that won't be shown anywhere.

Enter oplog tailing. Mongo keeps a record of all db operations; it looks just like any normal
Mongo collection. You can set a tailable cursor to follow it,
and be notified of all operations (delete, insert, update ...). But then, you have to parse the results
to figure out the current state of the database! That's not how I want to spend my short time
on this planet.

Props to Meteor engineers for doing it, but I'm only interested in dealing with a database that
tells me when something's changed.

## Hello redis

Redis is well known for being a "high performance key-value store". In other words, it's an
in-memory super-fast hashtable. I'll talk in a bit how to go from Mongo-mind to hash-mind (SQL to NoSQL is
a breeze in comparison), but the thing to understand here is that Redis offers "pub/sub".

Coming from Meteor, my understanding of pub/sub was that if a client (web browser) is subscribed to
some data source, then the back-end will publish any changes, and the client updates accordingly.

Not so! In fact, I learned that all it means is when something changes in the db, the back-end
(i.e. Node/Express) will be notified that something changed. Then you have to publish that
to the client over websockets.

And Redis, along with now-defunct RethinkDB, is the only database to offer that functionality.
That seems crazy, right? Firebase, and some other paid services, also do, but I'm still in the mindset
of staying away from things I can't predictably bill to my client.

### Use cases

No lie, the only time I used real-time sync like this with Meteor was to implement a chatroom.
In all other web apps I've built, which is many, there was no need for it.

Most examples you find online also relate to chatrooms. What I'm setting up here makes web-dev easier,
but slightly less efficient in the long run (at scale), and this is no exception.

And yet, the "realtime web" is coming. AJAX endpoints will become obsolete, an anachronism. Facebook
has it, in a purified form. Linking the view directly to the model is extremely attractive,
and for sure shortens dev time, increasing your ability to go-to-market with an MVP.

Let's proceed, cautiously optimistic.

## Databases in Redis vs everything else

Redis is a key-value store, a hash table. The problems with this are immense.

We're used to doing this:

```
mongo.findOne({id: 'abc123'}).then((err, res) => {
  console.log(res);
});
// res = {
//  title : 'My first article',
//  content: ObjectID('qqeeff123'),
//  previewImage: 'img/00a7bc.jpg'
//  }
//  .then... findOne({id: 'qqeeff1123'}) => {
//    text: 'long article post',
//    headerImg: 'img/1bf15c.jpg'
//  }).then...
//    send it to client;
```
And that's similar to SQL, which does the same but in a single query (though, with
  joins, and I prefer to do as much within JS as possible, so let me do my own joiny-things with ```then```).
But how do you do that from Redis, whilst also keeping it searchable?

Well, you have to reconsider everything about relational data, and make it
more explicit. Hold on to the concept of, "a single source of truth".
