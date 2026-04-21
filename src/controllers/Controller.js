// Controller contract — anything steering a ship implements this.
// Returned intent is what a network packet would look like in multiplayer:
//   { heading: radians, boost: bool }
// Local player, NPC, and (future) remote player all conform to this shape.
export class Controller {
  update(_ship, _ctx, _dt) {
    return { heading: 0, boost: false };
  }
}
