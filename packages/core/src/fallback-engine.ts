import type { FallbackTopic } from './types';

export class FallbackEngine {
  constructor(
    private topics: FallbackTopic[],
    private defaultResponse: string
  ) {}

  respond(message: string): string {
    const lower = message.toLowerCase();
    const matched = this.topics.find((topic) => topic.match.test(lower));
    return matched ? matched.response : this.defaultResponse;
  }
}
