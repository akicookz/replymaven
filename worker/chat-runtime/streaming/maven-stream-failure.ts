export class MavenStreamFailure extends Error {
  constructor() {
    super("The response stream failed.");
    this.name = "MavenStreamFailure";
  }
}
