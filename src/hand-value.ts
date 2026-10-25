import { handFeatures } from "./hand-features";
import { handModel } from "./hand-model";

export function trickDistribution(
  hand: number[],
  trump: number,
  first: number,
  discarded: number[] = [],
): number[] {
  let vector = handFeatures(hand, trump, first, discarded);
  if (vector.length !== handModel.features)
    throw Error("Hand model feature version mismatch");
  for (let i = 0; i < handModel.layers.length; i++) {
    const layer = handModel.layers[i];
    vector = layer.weights.map((weights, row) => {
      let sum = layer.bias[row];
      for (let col = 0; col < weights.length; col++)
        sum += weights[col] * vector[col];
      return i < handModel.layers.length - 1
        ? Math.max(0, sum)
        : sum / handModel.temperature;
    });
  }
  const max = Math.max(...vector),
    exps = vector.map((v) => Math.exp(v - max)),
    sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / sum);
}
