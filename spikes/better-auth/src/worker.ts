export default {
  async fetch(): Promise<Response> {
    return new Response("better-auth spike", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
