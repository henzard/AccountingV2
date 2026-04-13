export const SaveFormat = { JPEG: 'jpeg' };
export const manipulateAsync = jest.fn().mockResolvedValue({
  uri: 'file:///compressed.jpg',
  base64: 'dGVzdC1iYXNlNjQ=',
});
