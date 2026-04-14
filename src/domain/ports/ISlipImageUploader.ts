export interface ISlipImageUploader {
  upload(args: {
    householdId: string;
    slipId: string;
    frameIndex: number;
    base64: string;
  }): Promise<string>; // returns Storage path
}
