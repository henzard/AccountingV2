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
    const { getByText } = render(<OnboardingStepLayout title="T" subtitle="S" onCta={jest.fn()} />);
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
    const { getByText } = render(<OnboardingStepLayout title="T" subtitle="S" onCta={onCta} />);
    fireEvent.press(getByText('Next'));
    expect(onCta).toHaveBeenCalledTimes(1);
  });

  // UX-15: every step but the first offers a way back.
  it('renders no back control when onBack is omitted', () => {
    const { queryByTestId } = render(
      <OnboardingStepLayout title="T" subtitle="S" onCta={jest.fn()} />,
    );
    expect(queryByTestId('onboarding-back')).toBeNull();
  });

  it('renders a back control and calls onBack when it is pressed', () => {
    const onBack = jest.fn();
    const { getByTestId } = render(
      <OnboardingStepLayout title="T" subtitle="S" onCta={jest.fn()} onBack={onBack} />,
    );
    fireEvent.press(getByTestId('onboarding-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
