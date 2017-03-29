import React, { Component, PropTypes } from 'react';
import { logging, sseConnection } from '@jenkins-cd/blueocean-core-js';
import Extensions from '@jenkins-cd/js-extensions';
import { observer } from 'mobx-react';
import debounce from 'lodash.debounce';
import { QueuedState, NoSteps } from './QueuedState';
import { KaraokeService } from '../index';
import LogToolbar from './LogToolbar';
import Steps from './Steps';
import FreeStyle from './FreeStyle';

import { KaraokeConfig } from '../';
const logger = logging.logger('io.jenkins.blueocean.dashboard.karaoke.Pipeline');

@observer
export default class Pipeline extends Component {
    constructor(props) {
        super(props);
        this.listener = {};
        this.sseEventHandler = this.sseEventHandler.bind(this);
        this.showPending = KaraokeConfig.getPreference('runDetails.pipeline.showPending').value !== 'never'; // Configure flag to show pending or not
        this.karaoke = KaraokeConfig.getPreference('runDetails.pipeline.karaoke').value === 'never' ? false : props.augmenter.karaoke; // initial karaoke state
        this.updateOnFinish = KaraokeConfig.getPreference('runDetails.pipeline.updateOnFinish').value;
        this.stopOnClick = KaraokeConfig.getPreference('runDetails.pipeline.stopKaraokeOnAnyNodeClick').value === 'always';
    }
    componentWillMount() {
        // starting pipeline service when we have an augmenter
        if (this.props.augmenter) {
            const { augmenter, params: { node } } = this.props;
            this.pager = KaraokeService.pipelinePager(augmenter, { node });
        }
        // get sse listener to react on the different in sse events
        this.listener.ssePipeline = sseConnection.subscribe('pipeline', this.sseEventHandler);
        this.listener.sseJob = sseConnection.subscribe('job', this.sseEventHandler);
    }

    /**
     * Core logic to update and re-fetch data
     * @param nextProps
     */
    componentWillReceiveProps(nextProps) {
        // karaoke has changed state?
        if (!nextProps.augmenter.karaoke) {
            logger.debug('stopping karaoke mode.');
            this.stopKaraoke();
        }
        logger.debug('karaoke mode.',
            'nextProps.augmenter.karaoke ',
            nextProps.augmenter.karaoke, 'this.props.augmenter.karaoke',
            this.props.augmenter.karaoke, 'this.karaoke',
            this.karaoke);
        // update on finish and start, you can de-activate it by setting updateOnFinish to false
        //
        if (nextProps.run.id !== this.props.run.id || (this.updateOnFinish !== 'never' && nextProps.run.isCompleted() && !this.props.run.isCompleted())) {
            logger.debug('re-fetching since result changed and we want to display the full log and correct result states');
            // remove all timeouts in the backend
            this.stopKaraoke();
            if (nextProps.run !== this.props.run) {
                logger.debug('Need to set new Run. Happens when e.g. re-run.');
                nextProps.augmenter.setRun(nextProps.run);
            }
            debounce(() => {
                if (KaraokeConfig.getPreference('runDetails.pipeline.karaoke').value !== 'never') {
                    logger.debug('re-setting karaoke mode.');
                    this.karaoke = true;
                }
                this.pager.fetchNodes({ node: nextProps.params.node });
            }, 200)();
        }
        // switches from the url which node to focus
        if (nextProps.params.node !== this.props.params.node) {
            logger.debug('Need to fetch new nodes.');
            this.pager.fetchNodes({ node: nextProps.params.node });
        }
    }
    /**
     * Need to remove the listener to prevent memory leaks
     */
    componentWillUnmount() {
        this.stopKaraoke();
        if (this.listener.ssePipeline) {
            sseConnection.unsubscribe(this.listener.ssePipeline);
            delete this.listener.ssePipeline;
        }
        if (this.listener.sseJob) {
            sseConnection.unsubscribe(this.listener.sseJob);
            delete this.listener.sseJob;
        }
    }

    stopKaraoke() {
        logger.debug('stopping karaoke mode, by removing the timeouts on the pager.');
        this.pager.clear();
        this.karaoke = false;
    }

    /**
     * Listen for pipeline flow node events. We need to re-fetch in case of some events.
     * @param event sse event coming from the backende
     */
    sseEventHandler(event) {
         // we are using try/catch to throw an early out error
        try {
            logger.debug('incoming event', event);
            if (KaraokeConfig.getPreference('runDetails.pipeline.karaoke').value === 'never' || !this.karaoke) {
                logger.debug('early out because we do not want to follow along sse events');
                throw new Error('exit');
            }
            const jenkinsEvent = event.jenkins_event;
            const { run } = this.props;
            const runId = run.id;
             // we get events from the pipeline and the job channel, they have different naming for the id
            //  && event.jenkins_object_id !== runId -> job
            if (event.pipeline_run_id !== runId) {
                logger.debug('early out');
                throw new Error('exit');
            }
            switch (jenkinsEvent) {
            case 'pipeline_step': {
                logger.debug('sse event step fetchCurrentSteps', jenkinsEvent);
                debounce(() => {
                    logger.debug('sse fetch it', this.karaoke);
                    this.pager.fetchCurrentStepUrl();
                }, 200)();
                // prevent flashing of stages and nodes
                this.showPending = false;
                break;
            }
            case 'pipeline_end':
            case 'pipeline_start':
            case 'job_run_ended':
            case 'pipeline_block_end':
            case 'pipeline_stage': {
                logger.debug('sse event block starts refetchNodes', jenkinsEvent);
                debounce(() => {
                    logger.debug('sse fetch it', this.karaoke);
                    this.pager.fetchNodes({});
                }, 200)();
                // prevent flashing of stages and nodes
                this.showPending = false;
                break;
            }
            default: {
                logger.debug('ignoring event', jenkinsEvent);
            }
            }
        } catch (e) {
            // we only ignore the exit error
            if (e.message !== 'exit') {
                logger.error('sse Event has produced an error, will not work as expected.', e);
            }
        }
    }

    render() {
        const { t, run, augmenter, branch, pipeline, router, scrollToBottom, location } = this.props;
        // do we have something to display?
        const noResultsToDisplay = this.pager.steps === undefined || (this.pager.steps && !this.pager.steps.data.hasResultsForSteps);
        // Queue magic since a pipeline is only showing queued state a short time even if still waiting for executors
        const isPipelineQueued = run.isQueued() || (run.isRunning() && noResultsToDisplay);
        logger.debug('isQueued', run.isQueued(), 'noResultsToDisplay', noResultsToDisplay, 'isPipelineQueued', isPipelineQueued);
        const queuedMessage = t('rundetail.pipeline.queued.message', { defaultValue: 'Waiting for run to start' });
        if (run.isQueued()) { // if queued we are saying that we are waiting to start
            logger.debug('EarlyOut - abort due to run queued.');
            return <QueuedState message={queuedMessage} />;
        }
        const supportsNodes = this.pager.nodes === undefined;
        if(noResultsToDisplay && supportsNodes && !this.pager.pending) { // no information? fallback to freeStyle
            logger.debug('EarlyOut - We do not have any information we can display, falling back to freeStyle rendering');
            return (<FreeStyle {...this.props }/>);
        }
        if (this.pager.pending && this.showPending) { // we are waiting for the backend information
            logger.debug('EarlyOut - abort due to pager pending');
            const pendingMessage = t('rundetail.pipeline.pending.message', { defaultValue: 'Waiting for backend to response' });
            return <QueuedState message={pendingMessage} />;
        }
        // here we decide what to do next if somebody clicks on a flowNode
        // Underlying tasks are fetching nodes information for the selected node
        const afterClick = (id) => {
            logger.debug('clicked on node with id:', id);
            this.showPending = false; // Configure flag to not show pending anymore -> reduce flicker
            const nextNode = this.pager.nodes.data.model.filter((item) => item.id === id)[0];
            // remove trailing /
            const pathname = location.pathname.replace(/\/$/, '');
            let nextPath;
            if (pathname.endsWith('pipeline')) {
                nextPath = `${pathname}/${id}`;
            } else { // means we are in a node url
                // remove last bits
                const pathArray = pathname.split('/');
                pathArray.pop();
                pathArray.shift();
                nextPath = `/${pathArray.join('/')}/${id}`;
            }
            location.pathname = nextPath;
            logger.debug('redirecting now to:', location.pathname);
            // see whether we need to update the state
            if (nextNode.state === 'FINISHED' && this.karaoke) {
                logger.debug('turning off karaoke since we do not need it anymore because focus is on a finished node.');
                this.stopKaraoke();
            }
            if (!this.stopOnClick && nextNode.state !== 'FINISHED' && !this.karaoke) {
                logger.debug('turning on karaoke since we need it because we are focusing on a new node.');
                this.karaoke = true;
            }
            router.push(location);
        };
        const title = this.pager.nodes !== undefined ? t('rundetail.pipeline.steps', {
            defaultValue: 'Steps {0}',
            0: this.pager.currentNode.displayName,
        }) : '';
        // JENKINS-40526 node can provide logs only related to that node
        const logUrl = this.pager.nodes !== undefined ? augmenter.getNodesLogUrl(this.pager.currentNode) : augmenter.generalLogUrl;
        const logFileName = this.pager.nodes !== undefined ? augmenter.getNodesLogFileName(this.pager.currentNode) : augmenter.generalLogFileName;
        logger.debug('displayName', this.pager.currentNode.displayName, 'logging info', logUrl, logFileName);
        return (<div>
            { this.pager.nodes !== undefined &&
                <Extensions.Renderer
                    extensionPoint="jenkins.pipeline.run.result"
                    selectedStage={this.pager.currentNode}
                    callback={afterClick}
                    nodes={this.pager.nodes.data.model}
                    pipelineName={pipeline.displayName}
                    branchName={augmenter.isMultiBranchPipeline ? branch : undefined}
                    runId={run.id}
                    run={run}
                    t={t}
                />
            }
            { !isPipelineQueued && <LogToolbar
                fileName={logFileName}
                url={logUrl}
                title={title}
            /> }
            { this.pager.steps && !noResultsToDisplay &&
                <Steps
                    {...{
                        key: this.pager.currentStepsUrl,
                        nodeInformation: this.pager.steps.data,
                        followAlong: augmenter.karaoke,
                        augmenter,
                        t,
                        scrollToBottom,
                        router,
                        location,
                    }}
                />
            }

            { !isPipelineQueued && noResultsToDisplay && <NoSteps
                message={t('rundetail.pipeline.nosteps',
                { defaultValue: 'There are no logsrrr' })}
            /> }

            { isPipelineQueued && <QueuedState message={queuedMessage} /> }
        </div>);
    }
}
// nodeInformation: this.pager.steps.data
Pipeline.propTypes = {
    augmenter: PropTypes.object,
    pipeline: PropTypes.object,
    branch: PropTypes.string,
    run: PropTypes.object,
    t: PropTypes.func,
    router: PropTypes.shape,
    location: PropTypes.shape,
    scrollToBottom: PropTypes.bol,
    params: PropTypes.object,
};
