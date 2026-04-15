import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native-paper';
import { OnboardingStepLayout } from '../OnboardingStepLayout';

describe('OnboardingStepLayout', () => {
  it('renders title and subtitle', () => {
    const { getByText } = render(
      <OnboardingStepLayout title="Step title" subtitle="Step subtitle" onCta={jest.fn()}>
        <Text>child</Text>
      </OnboardingStepLayout>,
    );
    expect(getByText('Step title')).toBeTruthy();
    expect(getByText('Step subtitle')).toBeTruthy();
  });

  it('renders children', () => {
    const { getByText } = render(
      <OnboardingStepLayout title="T" subtitle="S" onCta={jest.fn()}>
        <Text>custom child</Text>
      </OnboardingStepLayout>,
    );
    expect(getByText('custom child')).toBeTruthy();
  });

  it('renders default CTA label "Next"', () => {
    const { getByText } = render(
      <OnboardingStepLayout title="T" subtitle="S" onCta={jest.fn()} />,
    );
    expect(getByText('Next')).toBeTruthy();
  });

  it('renders custom CTA label', () => {
    const { getByText } = render(
      <OnboardingStepLayout title="T" subtitle="S" ctaLabel="Save & Continue" onCta={jest.fn()} />,
    );
    expect(getByText('Save & Continue')).toBeTruthy();
  });

  it('calls onCta when CTA is pressed', () => {
    const onCta = jest.fn();
    const { getByText } = render(
      <OnboardingStepLayout title="T" subtitle="S" onCta={onCta} />,
    );
    fireEvent.press(getByText('Next'));
    expect(onCta).toHaveBeenCalledTimes(1);
  });
});
