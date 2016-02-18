package io.jenkins.blueocean.api.pipeline;

import io.jenkins.blueocean.commons.JsonConverter;
import org.junit.Assert;
import org.junit.Test;

/**
 * @author Vivek Pandey
 */
public class GetPipelineRequestTest {
    @Test
    public void serializeDeserialize(){
        GetPipelineRequest request = new GetPipelineRequest("cloudbees", "test1");

        String json = JsonConverter.toJson(request);

        System.out.println("Converted from Java:\n"+json);

        GetPipelineRequest requestFromJson = JsonConverter.toJava(json, GetPipelineRequest.class);


        Assert.assertEquals(request.organization, requestFromJson.organization);
        Assert.assertEquals(request.pipeline, requestFromJson.pipeline);
        System.out.println("Converted back from Json:\n"+JsonConverter.toJson(requestFromJson));
    }

}