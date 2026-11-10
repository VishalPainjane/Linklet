/**
 * High-performance caching contracts and algorithms:
 * - CacheRepository contract
 * - Custom O(1) LRU Cache with doubly linked list & TTL
 * - Single-flight duplicate query collapsing
 * - TTL calculator
 */

export interface CacheRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
}

export interface CacheStats {
  size: number;
  capacity: number;
  hits: number;
  misses: number;
  evictions: number;
}

interface LruNode<V> {
  key: string;
  value: V;
  expiresAtMs: number | null;
  prev: LruNode<V> | null;
  next: LruNode<V> | null;
}

/**
 * Custom O(1) LRU Cache implemented with a Hash Map and a Doubly Linked List.
 * Zero external dependencies. Designed for low tail latency.
 */
export class LruCache<V> {
  private readonly capacity: number;
  private readonly defaultTtlMs: number | null;
  private readonly map: Map<string, LruNode<V>> = new Map();
  private head: LruNode<V> | null = null; // MRU (Most Recently Used)
  private tail: LruNode<V> | null = null; // LRU (Least Recently Used)

  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(capacity = 1000, defaultTtlMs: number | null = null) {
    if (capacity <= 0) {
      throw new RangeError("Capacity must be greater than zero");
    }
    this.capacity = capacity;
    this.defaultTtlMs = defaultTtlMs;
  }

  public get(key: string): V | null {
    const node = this.map.get(key);
    if (!node) {
      this.misses += 1;
      return null;
    }

    // Check TTL expiration
    if (node.expiresAtMs !== null && Date.now() > node.expiresAtMs) {
      this.removeNode(node);
      this.map.delete(key);
      this.misses += 1;
      return null;
    }

    // Move to head (MRU)
    this.moveToHead(node);
    this.hits += 1;
    return node.value;
  }

  public set(key: string, value: V, ttlSeconds?: number): void {
    let expiresAtMs: number | null = null;
    if (typeof ttlSeconds === "number") {
      expiresAtMs = Date.now() + Math.max(0, ttlSeconds * 1000);
    } else if (this.defaultTtlMs !== null) {
      expiresAtMs = Date.now() + this.defaultTtlMs;
    }

    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      existing.expiresAtMs = expiresAtMs;
      this.moveToHead(existing);
      return;
    }

    // If at capacity, evict the LRU tail
    if (this.map.size >= this.capacity) {
      this.evictTail();
    }

    const newNode: LruNode<V> = {
      key,
      value,
      expiresAtMs,
      prev: null,
      next: null,
    };

    this.insertAtHead(newNode);
    this.map.set(key, newNode);
  }

  public delete(key: string): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.removeNode(node);
    this.map.delete(key);
    return true;
  }

  public clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  public getStats(): CacheStats {
    return {
      size: this.map.size,
      capacity: this.capacity,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }

  private moveToHead(node: LruNode<V>): void {
    if (this.head === node) return;
    this.removeNode(node);
    this.insertAtHead(node);
  }

  private insertAtHead(node: LruNode<V>): void {
    node.prev = null;
    node.next = this.head;
    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;
    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: LruNode<V>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }

    node.prev = null;
    node.next = null;
  }

  private evictTail(): void {
    if (!this.tail) return;
    const lruKey = this.tail.key;
    this.removeNode(this.tail);
    this.map.delete(lruKey);
    this.evictions += 1;
  }
}

/**
 * In-memory adapter implementing CacheRepository for local lab/testing
 */
export class InMemoryCacheRepository implements CacheRepository {
  private readonly cache: LruCache<string>;

  constructor(capacity = 10_000) {
    this.cache = new LruCache<string>(capacity);
  }

  public async get(key: string): Promise<string | null> {
    return this.cache.get(key);
  }

  public async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.cache.set(key, value, ttlSeconds);
  }

  public async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  public async setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
    const existing = this.cache.get(key);
    if (existing !== null) {
      return false;
    }
    this.cache.set(key, value, ttlMs / 1000);
    return true;
  }

  public getStats(): CacheStats {
    return this.cache.getStats();
  }

  public clear(): void {
    this.cache.clear();
  }
}

/**
 * SingleFlight collapses duplicate concurrent requests for the same key into a single
 * execution, preventing cache stampedes.
 */
export class SingleFlight<T> {
  private inFlight = new Map<string, Promise<T>>();

  public async do(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  public get activeCount(): number {
    return this.inFlight.size;
  }
}

/**
 * Calculates Redis / Cache TTL honoring URL expiration lifetime and max ceiling.
 * If expired, returns 0.
 */
export function calculateCacheTtlSeconds(
  expiresAt: Date | null,
  configuredMaxSeconds = 900, // 15 mins default
  nowMs = Date.now(),
): number {
  if (!expiresAt) {
    return configuredMaxSeconds;
  }
  const remainingSeconds = Math.floor((expiresAt.getTime() - nowMs) / 1000);
  if (remainingSeconds <= 0) {
    return 0;
  }
  return Math.min(configuredMaxSeconds, remainingSeconds);
}

