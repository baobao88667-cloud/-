/**
 * Upstash Redis REST API 连接封装
 * 
 * 环境变量：
 * - UPSTASH_REDIS_REST_URL: Upstash REST API URL
 * - UPSTASH_REDIS_REST_TOKEN: Upstash REST API Token
 */

import { Redis } from '@upstash/redis';

// 创建 Upstash Redis 客户端
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// 导出 kv 接口
export const kv = {
  // Hash 操作
  async hgetall(key) {
    try {
      const data = await redis.hgetall(key);
      if (!data || Object.keys(data).length === 0) return null;
      return data;
    } catch (e) {
      console.error('Redis HGETALL error:', e);
      return null;
    }
  },
  
  async hset(key, data) {
    try {
      await redis.hset(key, data);
      return 'OK';
    } catch (e) {
      console.error('Redis HSET error:', e);
      throw e;
    }
  },

  async hget(key, field) {
    try {
      return await redis.hget(key, field);
    } catch (e) {
      console.error('Redis HGET error:', e);
      return null;
    }
  },

  async hincrby(key, field, increment) {
    try {
      return await redis.hincrby(key, field, increment);
    } catch (e) {
      console.error('Redis HINCRBY error:', e);
      throw e;
    }
  },
  
  // Set 操作
  async smembers(key) {
    try {
      return await redis.smembers(key) || [];
    } catch (e) {
      console.error('Redis SMEMBERS error:', e);
      return [];
    }
  },
  
  async sadd(key, member) {
    try {
      return await redis.sadd(key, member);
    } catch (e) {
      console.error('Redis SADD error:', e);
      throw e;
    }
  },
  
  async srem(key, member) {
    try {
      return await redis.srem(key, member);
    } catch (e) {
      console.error('Redis SREM error:', e);
      throw e;
    }
  },

  async sismember(key, member) {
    try {
      return await redis.sismember(key, member);
    } catch (e) {
      console.error('Redis SISMEMBER error:', e);
      return 0;
    }
  },
  
  // List 操作 (用于历史记录)
  async lpush(key, ...values) {
    try {
      return await redis.lpush(key, ...values);
    } catch (e) {
      console.error('Redis LPUSH error:', e);
      throw e;
    }
  },

  async lrange(key, start, stop) {
    try {
      return await redis.lrange(key, start, stop) || [];
    } catch (e) {
      console.error('Redis LRANGE error:', e);
      return [];
    }
  },

  async llen(key) {
    try {
      return await redis.llen(key) || 0;
    } catch (e) {
      console.error('Redis LLEN error:', e);
      return 0;
    }
  },
  
  // 基本操作
  async del(key) {
    try {
      return await redis.del(key);
    } catch (e) {
      console.error('Redis DEL error:', e);
      throw e;
    }
  },
  
  async get(key) {
    try {
      return await redis.get(key);
    } catch (e) {
      console.error('Redis GET error:', e);
      return null;
    }
  },
  
  async set(key, value, options) {
    try {
      if (options && options.ex) {
        return await redis.set(key, value, { ex: options.ex });
      }
      return await redis.set(key, value);
    } catch (e) {
      console.error('Redis SET error:', e);
      throw e;
    }
  },

  async exists(key) {
    try {
      return await redis.exists(key);
    } catch (e) {
      console.error('Redis EXISTS error:', e);
      return 0;
    }
  },

  async keys(pattern) {
    try {
      return await redis.keys(pattern) || [];
    } catch (e) {
      console.error('Redis KEYS error:', e);
      return [];
    }
  }
};

// Token 生成工具
export const crypto = {
  generateToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 64; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }
};
