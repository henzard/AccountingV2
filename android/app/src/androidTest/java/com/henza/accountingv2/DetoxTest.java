package com.henza.accountingv2;

import com.wix.detox.Detox;
import com.wix.detox.config.DetoxConfig;

import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.LargeTest;
import androidx.test.rule.ActivityTestRule;

@RunWith(AndroidJUnit4.class)
@LargeTest
public class DetoxTest {
    @Rule
    public ActivityTestRule<MainActivity> mActivityRule = new ActivityTestRule<>(MainActivity.class, false, false);

    @Test
    public void runDetoxTests() {
        DetoxConfig detoxConfig = new DetoxConfig();
        detoxConfig.idlePolicyConfig.masterTimeoutSec = 90;
        detoxConfig.idlePolicyConfig.idleResourceTimeoutSec = 60;
        // Supabase keeps OkHttp connections open (auth session, realtime WebSocket).
        // Without this blacklist Detox waits the full idleResourceTimeoutSec for those
        // connections to drain before sending the first UI command, causing every test
        // to hit the 60-second timeout and report "unexpectedly disconnected".
        detoxConfig.idlePolicyConfig.networkRequestParams.blacklistURLs = new String[] {
            ".*supabase\\.co.*",
            ".*firebase.*",
            ".*crashlytics.*",
        };

        Detox.runTests(mActivityRule, detoxConfig);
    }
}
