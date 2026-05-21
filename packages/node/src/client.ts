import { AddressesResource } from "./resources/addresses.js";
import { CertificationsResource } from "./resources/certifications.js";
import { EntitiesResource } from "./resources/entities.js";
import { JobsResource } from "./resources/jobs.js";
import { MetaResource } from "./resources/meta.js";
import { MonitorsResource } from "./resources/monitors.js";
import { ProvidersResource } from "./resources/providers.js";
import { UsageResource } from "./resources/usage.js";
import { VerificationsResource } from "./resources/verifications.js";
import { resolveOptions, type ClientOptions, type ResolvedClientOptions } from "./request.js";
import * as webhooksModule from "./webhooks.js";
import { API_VERSION, VERSION } from "./version.js";

export class Vendorval {
  static readonly VERSION = VERSION;
  static readonly API_VERSION = API_VERSION;

  readonly entities: EntitiesResource;
  readonly verifications: VerificationsResource;
  readonly certifications: CertificationsResource;
  readonly monitors: MonitorsResource;
  readonly providers: ProvidersResource;
  readonly meta: MetaResource;
  readonly usage: UsageResource;
  readonly jobs: JobsResource;
  readonly addresses: AddressesResource;
  readonly webhooks = webhooksModule;

  /** Resolved options. Useful for advanced consumers. */
  readonly options: ResolvedClientOptions;

  constructor(options: ClientOptions = {}) {
    this.options = resolveOptions(options);
    this.entities = new EntitiesResource(this.options);
    this.verifications = new VerificationsResource(this.options);
    this.certifications = new CertificationsResource(this.options);
    this.monitors = new MonitorsResource(this.options);
    this.providers = new ProvidersResource(this.options);
    this.meta = new MetaResource(this.options);
    this.usage = new UsageResource(this.options);
    this.jobs = new JobsResource(this.options);
    this.addresses = new AddressesResource(this.options);
  }
}
