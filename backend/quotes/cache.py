import json, time, uuid
from functools import lru_cache
import redis
from django.conf import settings


@lru_cache(maxsize=4)
def client_for(url):
    return redis.Redis.from_url(
        url,
        decode_responses=True,
        socket_connect_timeout=settings.REDIS_SOCKET_TIMEOUT,
        socket_timeout=settings.REDIS_SOCKET_TIMEOUT,
        max_connections=30,
    )


def connection():
    return client_for(settings.REDIS_URL)


def get(key):
    try:
        value = connection().get(key)
        result = json.loads(value) if value else None
        return result if isinstance(result, dict) else None
    except (redis.RedisError, ValueError):
        return None


def set_value(key, value, ttl):
    try:
        return bool(connection().set(key, json.dumps(value), ex=ttl))
    except redis.RedisError:
        return False


def ttl(key):
    try:
        return connection().ttl(key)
    except redis.RedisError:
        return -2


def metric(owner, kind, duration=0):
    try:
        c = connection()
        k = f"qg:metrics:{owner}"
        with c.pipeline() as p:
            p.hincrby(k, kind, 1)
            p.hset(k, "last_duration_ms", round(duration, 3))
            p.hset(
                k,
                "last_calculation_duration_ms"
                if kind.startswith("calculation_")
                else "last_lookup_duration_ms",
                round(duration, 3),
            )
            p.expire(k, 86400)
            p.execute()
    except redis.RedisError:
        pass


def metrics(owner):
    try:
        result = connection().hgetall(f"qg:metrics:{owner}")
        available = True
    except redis.RedisError:
        result = {}
        available = False
    hits = int(result.get("hit", 0))
    misses = int(result.get("miss", 0))
    return {
        **result,
        "hits": hits,
        "misses": misses,
        "hit_ratio": hits / (hits + misses) if hits + misses else 0,
        "redis_available": available,
    }


class Lock:
    # Six seconds exceeds the four second upstream timeout. Ownership-checked release.
    def __init__(self, key):
        self.key = key
        self.token = uuid.uuid4().hex
        self.owned = False
        self.available = True

    def acquire(self):
        deadline = time.monotonic() + 1.5
        try:
            while time.monotonic() < deadline:
                if connection().set(self.key, self.token, nx=True, ex=6):
                    self.owned = True
                    return True
                time.sleep(0.04)
        except redis.RedisError:
            self.available = False
            return True
        return False

    def publish(self, key, value, ttl):
        if not self.owned:
            return False
        try:
            return bool(
                connection().eval(
                    "if redis.call('get',KEYS[1]) == ARGV[1] then redis.call('set',KEYS[2],ARGV[2],'EX',ARGV[3]); return 1 else return 0 end",
                    2,
                    self.key,
                    key,
                    self.token,
                    json.dumps(value),
                    ttl,
                )
            )
        except redis.RedisError:
            return False

    def release(self):
        if self.owned:
            try:
                connection().eval(
                    "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
                    1,
                    self.key,
                    self.token,
                )
            except redis.RedisError:
                pass
