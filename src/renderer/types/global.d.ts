import type { S3Api } from '../../preload';

declare global {
  interface Window {
    s3: S3Api;
  }
}

export {};
