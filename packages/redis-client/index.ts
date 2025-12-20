import Redis from 'ioredis';

const redisClient = new Redis({
    port: 6380,
});

export default redisClient;