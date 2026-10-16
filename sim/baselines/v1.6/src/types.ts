export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";
export type Suit = "clubs" | "diamonds" | "hearts" | "spades";

export type Card = {
  rank: Rank;
  suit: Suit;
};

export type PlayerState = {
  id: number;
  name: string;
  status: "active" | "folded" | "out";
  version: string;
  stack: number;
  bet: number;
  // Only present for our own player
  hole_cards?: Card[];
};

export type GameState = {
  tournament_id: string;
  game_id: string;
  round: number;
  bet_index: number;
  small_blind: number;
  current_buy_in: number;
  pot: number;
  minimum_raise: number;
  dealer: number;
  orbits: number;
  in_action: number;
  players: PlayerState[];
  community_cards: Card[];
};
