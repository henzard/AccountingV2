export interface HouseholdRow {
  id: string;
  name: string;
  paydayDay: number;
  userLevel: number;
  createdAt: string;
  updatedAt: string;
  isSynced: boolean;
}

export interface IHouseholdRepository {
  findById(id: string): Promise<HouseholdRow | null>;
  insert(household: HouseholdRow): Promise<void>;
}
