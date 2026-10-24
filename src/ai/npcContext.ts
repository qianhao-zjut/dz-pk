/** 执行器确认动作后、改牌桌前同步带上的依据。失效决策不会产生这条记录。 */
export interface NpcActionContext {
  turnToken: string;
  actorId: string;
  reasonCode: string;
  profileId: string;
  position: string | null;
  handKey: string | null;
  priceTier: string | null;
  stackDepth: string | null;
  samples: number;
  equity: number | null;
  evReference: number | null;
  assumptions: string[];
  fallback: boolean;
  rngDraw: number | null;
}
