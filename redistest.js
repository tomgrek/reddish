var redis = require("redis");
var sub = redis.createClient(), pub = redis.createClient();

sub.get('demo', console.log);

sub.psubscribe("__keyspace@0__:demo:data*");
sub.on('pmessage',(a,b,c,d)=>{
  console.log(b);
  pub.keys("demo:data:*",(err, keys) => {
    keys.map(key => pub.hgetall(key, (err, d) => console.log(d.content)));
  });
});

// need to sudo nano /etc/redis/redis.conf to put KA
// redis-cli:
// hset demo:data:abc123 hashkey value
// hset demo:data def1 '{"_id":"def1", "content":"content def1"}'
// (integer) 1
// 127.0.0.1:6379> hdel
// (error) ERR wrong number of arguments for 'hdel' command
// 127.0.0.1:6379> hdel demo:data def1
// (integer) 1
// 127.0.0.1:6379> hset demo:data def1 '{"_id":"def1", "content":"content def1"}'
// hscan demo:data 0 match d*
