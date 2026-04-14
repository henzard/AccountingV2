// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_icy_stellaris.sql';
import m0001 from './0001_vengeful_vivisector.sql';
import m0002 from './0002_household_members.sql';
import m0003 from './0003_grey_james_howlett.sql';
import m0004 from './0004_safe_sleeper.sql';
import m0005 from './0005_pending_sync_dlq.sql';
import m0006 from './0006_round_betty_brant.sql';
import m0007 from './0007_household_members_updated_at.sql';
import m0008 from './0008_slip_scanning.sql';

export default {
  journal,
  migrations: {
    m0000,
    m0001,
    m0002,
    m0003,
    m0004,
    m0005,
    m0006,
    m0007,
    m0008,
  },
};
