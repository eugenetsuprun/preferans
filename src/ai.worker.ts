import { botAction } from "./bot";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      id: data.id,
      action: botAction(data.game, data.observer),
    });
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error) });
  }
};
