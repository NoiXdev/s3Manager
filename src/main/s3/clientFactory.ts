import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import type { ProviderId } from './providers';

export interface ConnectionProfile {
  provider: ProviderId;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export function buildClientConfig(profile: ConnectionProfile): S3ClientConfig {
  const config: S3ClientConfig = {
    region: profile.region,
    forcePathStyle: profile.forcePathStyle,
    credentials: {
      accessKeyId: profile.accessKeyId,
      secretAccessKey: profile.secretAccessKey,
    },
  };
  if (profile.endpoint) config.endpoint = profile.endpoint;
  return config;
}

export function createClient(profile: ConnectionProfile): S3Client {
  return new S3Client(buildClientConfig(profile));
}
