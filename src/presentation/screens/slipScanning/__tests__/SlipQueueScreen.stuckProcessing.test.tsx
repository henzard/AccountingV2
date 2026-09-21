/**
 * SlipQueueScreen.stuckProcessing.test.tsx — A-2
 *
 * UploadSlipImagesUseCase replaces a slip's `imageUris` with the REMOTE
 * Storage paths once the frames are uploaded (a synced column whose meaning
 * must not change). If the app dies between that write and extraction, the
 * device no longer holds the frames — and the `extract-slip` edge function
 * only accepts inline `images_base64`, so the scan genuinely cannot be
 * resumed. The old resume path handed those remote paths to SlipProcessing as
 * "local frame URIs"; the compressor throws on them, so the row stayed at
 * 'processing' forever, one failed tap at a time.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { useToastStore } from '../../../stores/toastStore';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  return {
    ...jest.requireActual('@react-navigation/native'),
    useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      R.useEffect(() => cb(), [cb]);
    },
  };
});

jest.mock('../../../../data/local/db', () => ({ db: {} }));

const mockGetConfirmedSlipIds = jest.fn().mockResolvedValue(new Set<string>());
jest.mock('../../../../domain/slipScanning/SlipTransactionStatusQuery', () => ({
  getConfirmedSlipIds: (...args: unknown[]) => mockGetConfirmedSlipIds(...args),
}));

const mockConfirm = jest.fn().mockResolvedValue(true);
jest.mock('../../../components/shared/ConfirmDialogHost', () => ({
  confirm: (...args: unknown[]) => mockConfirm(...args),
}));

jest.mock('react-native-paper', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const Text = ({
    children,
    testID,
    ...p
  }: {
    children?: React.ReactNode;
    testID?: string;
    [k: string]: unknown;
  }) => React.createElement('Text', { testID, ...p }, children);
  const Chip = ({
    children,
    testID,
    textStyle: _textStyle,
    ...p
  }: {
    children?: React.ReactNode;
    testID?: string;
    textStyle?: object;
    [k: string]: unknown;
  }) => React.createElement('View', { testID, ...p }, React.createElement('Text', {}, children));
  const FAB = ({ testID, onPress }: { testID?: string; onPress?: () => void }) =>
    React.createElement('Pressable', { testID, onPress });
  return { Text, Chip, FAB };
});

const baseProcessing = {
  id: 'sq-3',
  householdId: 'hh-1',
  createdBy: 'user-1',
  status: 'processing',
  merchant: null,
  slipDate: null,
  totalCents: null,
  errorMessage: null,
  rawResponseJson: null,
  imagesDeletedAt: null,
  openaiCostCents: 0,
  createdAt: '2026-04-14T10:00:00Z',
  updatedAt: '2026-04-14T10:00:00Z',
};

/** Killed BEFORE upload — the local capture frames are still on the device. */
const resumableSlip = {
  ...baseProcessing,
  imageUris: ['file:///frame-a.jpg', 'file:///frame-b.jpg'],
};

/**
 * Killed AFTER upload — `imageUris` are the uploader's remote Storage paths,
 * and the row is long past STRANDED_SLIP_MIN_AGE_MS (2026-04-14).
 */
const strandedSlip = {
  ...baseProcessing,
  imageUris: ['hh-1/sq-3/0.jpg', 'hh-1/sq-3/1.jpg'],
};

/**
 * Same signature, but written seconds ago: slip_queue is synced, so this is
 * what a partner's scan (or this device's own) looks like WHILE it is still
 * extracting. It must never be offered up for clearing.
 */
const inFlightSlip = {
  ...strandedSlip,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

let mockSlipData: any[] = [strandedSlip];

jest.mock('../../../hooks/useSlipHistory', () => ({
  useSlipHistory: () => mockSlipData,
}));

import {
  SlipQueueScreen,
  classifyProcessingSlip,
  STRANDED_SLIP_MIN_AGE_MS,
} from '../SlipQueueScreen';

function makeRepo(): { listByHousehold: jest.Mock; update: jest.Mock } {
  return {
    listByHousehold: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(undefined),
  };
}

describe('SlipQueueScreen — un-resumable processing slip (A-2)', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockSlipData = [strandedSlip];
    mockGetConfirmedSlipIds.mockReset().mockResolvedValue(new Set<string>());
    mockConfirm.mockReset().mockResolvedValue(true);
    useToastStore.getState().clear();
  });

  it('does not restart a scan from remote Storage paths', async () => {
    const repo = makeRepo();

    const { getByTestId } = render(<SlipQueueScreen repo={repo as any} householdId="hh-1" />);

    await act(async () => {
      fireEvent.press(getByTestId('slip-item-sq-3'));
    });

    // The old behaviour: navigate to SlipProcessing with remote paths as
    // `frameLocalUris`, which the compressor cannot read.
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalled();
  });

  it('marks the stranded slip failed when the user accepts clearing it', async () => {
    const repo = makeRepo();

    const { getByTestId } = render(<SlipQueueScreen repo={repo as any} householdId="hh-1" />);

    await act(async () => {
      fireEvent.press(getByTestId('slip-item-sq-3'));
    });

    // Existing synced columns only — the same pair ExtractSlipUseCase writes
    // when extraction fails, so the row taps through to a re-scan.
    expect(repo.update).toHaveBeenCalledWith('sq-3', {
      status: 'failed',
      errorMessage: expect.stringContaining('no longer on this device'),
    });
    expect(
      useToastStore
        .getState()
        .queue.map((t) => t.message)
        .join(' '),
    ).toContain('cleared');
  });

  it('leaves the slip untouched when the user declines', async () => {
    mockConfirm.mockResolvedValue(false);
    const repo = makeRepo();

    const { getByTestId } = render(<SlipQueueScreen repo={repo as any} householdId="hh-1" />);

    await act(async () => {
      fireEvent.press(getByTestId('slip-item-sq-3'));
    });

    expect(repo.update).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('surfaces an error toast when clearing the slip fails', async () => {
    const repo = makeRepo();
    repo.update.mockRejectedValue(new Error('db locked'));

    const { getByTestId } = render(<SlipQueueScreen repo={repo as any} householdId="hh-1" />);

    await act(async () => {
      fireEvent.press(getByTestId('slip-item-sq-3'));
    });

    const kinds = useToastStore.getState().queue.map((t) => t.kind);
    expect(kinds).toContain('error');
  });

  it('never offers to clear a remote-path slip that is still being extracted', async () => {
    mockSlipData = [inFlightSlip];
    const repo = makeRepo();

    const { getByTestId } = render(<SlipQueueScreen repo={repo as any} householdId="hh-1" />);

    await act(async () => {
      fireEvent.press(getByTestId('slip-item-sq-3'));
    });

    // A partner's live scan must not be marked failed out from under them,
    // and there is still nothing local to resume from either.
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(
      useToastStore
        .getState()
        .queue.map((t) => t.message)
        .join(' '),
    ).toContain('still being read');
  });

  it('still resumes a slip whose frames are local device URIs (M7 unchanged)', async () => {
    mockSlipData = [resumableSlip];
    const repo = makeRepo();

    const { getByTestId } = render(<SlipQueueScreen repo={repo as any} householdId="hh-1" />);

    await act(async () => {
      fireEvent.press(getByTestId('slip-item-sq-3'));
    });

    expect(mockNavigate).toHaveBeenCalledWith('SlipProcessing', {
      householdId: 'hh-1',
      createdBy: 'user-1',
      frameLocalUris: ['file:///frame-a.jpg', 'file:///frame-b.jpg'],
    });
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe('classifyProcessingSlip (pure)', () => {
  const nowMs = Date.parse('2026-04-14T12:00:00Z');
  const at = (offsetMs: number): string => new Date(nowMs - offsetMs).toISOString();

  function remoteRow(stamps: { updatedAt: string; createdAt: string }) {
    return { ...strandedSlip, ...stamps } as any;
  }

  it('resumes when the frames are local device URIs, whatever the age', () => {
    expect(classifyProcessingSlip(resumableSlip as any, nowMs)).toBe('resume');
  });

  it('waits while a remote-path slip is younger than the stranded threshold', () => {
    expect(
      classifyProcessingSlip(remoteRow({ updatedAt: at(1_000), createdAt: at(2_000) }), nowMs),
    ).toBe('wait');
    // Just inside the boundary — a 60s worst-case extraction is still live.
    expect(
      classifyProcessingSlip(
        remoteRow({
          updatedAt: at(STRANDED_SLIP_MIN_AGE_MS - 1),
          createdAt: at(STRANDED_SLIP_MIN_AGE_MS - 1),
        }),
        nowMs,
      ),
    ).toBe('wait');
  });

  it('treats a remote-path slip at or past the threshold as stranded', () => {
    expect(
      classifyProcessingSlip(
        remoteRow({
          updatedAt: at(STRANDED_SLIP_MIN_AGE_MS),
          createdAt: at(STRANDED_SLIP_MIN_AGE_MS),
        }),
        nowMs,
      ),
    ).toBe('stranded');
  });

  it('prefers updatedAt over createdAt', () => {
    // Created long ago but touched a second ago (e.g. a re-extraction).
    expect(
      classifyProcessingSlip(remoteRow({ updatedAt: at(1_000), createdAt: at(86_400_000) }), nowMs),
    ).toBe('wait');
  });

  it('falls back to createdAt when updatedAt is unparseable', () => {
    expect(
      classifyProcessingSlip(remoteRow({ updatedAt: 'not-a-date', createdAt: at(1_000) }), nowMs),
    ).toBe('wait');
    expect(
      classifyProcessingSlip(
        remoteRow({ updatedAt: 'not-a-date', createdAt: at(STRANDED_SLIP_MIN_AGE_MS) }),
        nowMs,
      ),
    ).toBe('stranded');
  });

  it('treats a row with no usable timestamp as stranded, so it can never be un-clearable', () => {
    expect(
      classifyProcessingSlip(remoteRow({ updatedAt: 'not-a-date', createdAt: '' }), nowMs),
    ).toBe('stranded');
  });
});
